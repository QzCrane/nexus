// goal: run a native write's stabilization proof after the transaction answered
//
// The executor owns *writing*; this registry owns *proving*, detached from the
// control path. Splitting the two is what lets a write answer immediately while
// keeping the rollback detection that made the stabilization window worth paying
// for in the first place.

import type { ControlValues, ControlWriteState } from '@nexus/contracts';
import { confirmStableNativeEvent } from './native-media-async';
import { recordNativeWriteOutcome } from './native-write-policy';
import { settleNativeWrite } from './native-write-telemetry';

/**
 * The native fields a write can restore. Owned here because both the executor
 * (which writes them) and this registry (which proves them) need the same union,
 * and a second declaration would silently drift.
 */
export type RestorableMediaField = 'volumeBase' | 'mediaMuted' | 'speed' | 'preservePitch' | 'loop';

export interface WriteConfirmationRequest {
	readonly element: HTMLMediaElement;
	readonly field: RestorableMediaField;
	readonly desired: ControlValues[RestorableMediaField];
	readonly tolerance: number;
	readonly siteKey: string;
	readonly sampleId: number;
	readonly startedAt: number;
	readonly signal?: AbortSignal;
	readonly isCurrent?: () => boolean;
	/** Reports what the page really holds once a rollback is proven. */
	readonly onDrift: (actual: ControlValues[RestorableMediaField]) => void;
}

function readActual(
	element: HTMLMediaElement,
	field: RestorableMediaField,
): ControlValues[RestorableMediaField] {
	switch (field) {
		case 'mediaMuted': return element.muted as ControlValues[RestorableMediaField];
		case 'speed': return element.playbackRate as ControlValues[RestorableMediaField];
		case 'preservePitch':
			return (element as HTMLMediaElement & { preservesPitch: boolean })
				.preservesPitch as ControlValues[RestorableMediaField];
		case 'loop': return element.loop as ControlValues[RestorableMediaField];
		default: return (element.volume * 100) as ControlValues[RestorableMediaField];
	}
}

export class NativeWriteConfirmationRegistry {
	private readonly controllers = new Map<string, AbortController>();

	/**
	 * Why this is safe rather than merely fast:
	 * - Nothing here can fail the transaction. A rollback is reported as
	 *   `drifted`, never thrown, so the control path cannot regress.
	 * - A newer write cancels the proof of the write it supersedes, so verdicts
	 *   cannot arrive out of order and overwrite a fresher value.
	 * - A drift is handed back to the caller, which publishes the true value, so
	 *   every later read, snapshot and projection reports reality.
	 * - The outcome feeds the per-site ledger, which demotes origins that keep
	 *   taking fields back to the historical verified path.
	 */
	schedule(key: string, request: WriteConfirmationRequest): void {
		const {
			element,
			field,
			desired,
			tolerance,
			siteKey,
			sampleId,
			startedAt,
			signal,
			isCurrent,
			onDrift,
		} = request;
		this.controllers.get(key)?.abort();
		const controller = new AbortController();
		this.controllers.set(key, controller);
		const onLifecycleAbort = (): void => controller.abort();
		signal?.addEventListener('abort', onLifecycleAbort, { once: true });
		void (async (): Promise<void> => {
			try {
				const { actual, matched } = await confirmStableNativeEvent(
					element,
					field === 'speed' ? 'ratechange' : 'volumechange',
					() => readActual(element, field),
					desired,
					tolerance,
					750,
					{ signal: controller.signal, isCurrent },
				);
				const writeState: ControlWriteState = matched ? 'confirmed' : 'drifted';
				settleNativeWrite(sampleId, writeState, performance.now() - startedAt);
				recordNativeWriteOutcome(siteKey, writeState);
				if (writeState === 'drifted') onDrift(actual);
			} catch {
				// A superseded or lifecycle-cancelled proof says nothing about the
				// write. `unconfirmed` records that no verdict was reached and
				// deliberately does not count as drift.
				if (!controller.signal.aborted) {
					settleNativeWrite(sampleId, 'unconfirmed', performance.now() - startedAt);
					recordNativeWriteOutcome(siteKey, 'unconfirmed');
				}
			} finally {
				signal?.removeEventListener('abort', onLifecycleAbort);
				if (this.controllers.get(key) === controller) this.controllers.delete(key);
			}
		})();
	}

	/** Detached proofs own element listeners; never leave them behind. */
	abortAll(): void {
		for (const controller of this.controllers.values()) controller.abort();
		this.controllers.clear();
	}
}
