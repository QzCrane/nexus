// goal: run a native write's stabilization proof after the transaction answered
//
// The executor owns *writing*; this registry owns *proving*, detached from the
// control path. Splitting the two is what lets a write answer immediately while
// keeping the rollback detection that made the stabilization window worth paying
// for in the first place.

import type { ControlValues, ControlWriteState } from '@nexus/contracts';
import { confirmStableNativeEvent, nativeValuesMatch } from './native-media-async';
import { recordNativeWriteOutcome } from './native-write-policy';
import { settleNativeWrite } from './native-write-telemetry';

/**
 * The native fields a write can restore. Owned here because both the executor
 * (which writes them) and this registry (which proves them) need the same union,
 * and a second declaration would silently drift.
 */
export type RestorableMediaField = 'volumeBase' | 'mediaMuted' | 'speed' | 'preservePitch' | 'loop';

/**
 * The fields whose write can answer before it is proven.
 *
 * This is not every restorable field: a field with no native event to announce a
 * change (preservePitch, loop) has nothing to defer to, so its two-frame readback
 * stays inside the transaction and it never appears here.
 */
export type NativeProofField =
	| 'volumeBase'
	| 'mediaMuted'
	| 'speed'
	| 'playing'
	| 'pip'
	| 'fullscreen';

/** Numbers use the tolerance; booleans compare exactly. */
export type NativeProofValue = number | boolean;

/**
 * The audit has to outlast a React render, not a network round trip. 300ms is
 * roughly three frames plus the commit phase of a batched update; the interval
 * keeps the cross-world read off the animation frame path.
 */
const PROJECTION_AUDIT_BUDGET_MS = 300;
const PROJECTION_AUDIT_INTERVAL_MS = 40;

export interface WriteConfirmationRequest {
	readonly element: HTMLMediaElement;
	readonly field: NativeProofField;
	/**
	 * The native events that can announce a change to this field. Supplied by the
	 * writer rather than derived here: `playing` needs both `play` and `pause`,
	 * PiP needs both directions, and a page that stops delivering events must not
	 * leave the proof with nothing to wait on.
	 */
	readonly events: readonly string[];
	/**
	 * The physical value this write is proving. Also supplied by the writer: the
	 * same field is read through a page controller on one site and the DOM
	 * property on another, and only the writer knows which witness is authoritative.
	 */
	readonly read: () => NativeProofValue;
	readonly desired: NativeProofValue;
	readonly tolerance: number;
	readonly siteKey: string;
	readonly sampleId: number;
	readonly startedAt: number;
	readonly signal?: AbortSignal;
	readonly isCurrent?: () => boolean;
	/** Reports what the page really holds once a rollback is proven. */
	readonly onDrift: (actual: NativeProofValue) => void;
}

export interface ProjectionAuditRequest {
	readonly element: HTMLMediaElement;
	readonly field: RestorableMediaField;
	readonly desired: ControlValues[RestorableMediaField];
	/** The badge's own rounding budget, not the media element's tolerance. */
	readonly tolerance: number;
	readonly siteKey: string;
	/**
	 * Reads what the player's UI shows. Returning `null` means "unreadable",
	 * which is never evidence of agreement.
	 */
	readonly readProjection: () => ControlValues[RestorableMediaField] | null;
	readonly signal?: AbortSignal;
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
			events,
			read,
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
					events,
					read,
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

	/**
	 * Prove the page's own UI followed a declared write.
	 *
	 * A `declared-official` write only answers once the controller's getter
	 * agrees, which says nothing about the badge the viewer reads. This audit
	 * closes that gap: it runs detached from the control path, tolerates the
	 * player's asynchronous render by polling a bounded window, and records the
	 * verdict in the per-site ledger. A badge that never follows therefore turns
	 * into `drifted` — visible in telemetry and in `snapshotNativeWritePolicy()`
	 * — instead of the invisible divergence documented in
	 * `docs/research/2026-11-01-spectra-douyin-speed-sync-root-cause.md`.
	 *
	 * It never throws and never reverts: the playback rate is already correct, so
	 * the honest action is to record the disagreement, not to undo the viewer's
	 * request.
	 */
	auditProjection(key: string, request: ProjectionAuditRequest): void {
		const { desired, tolerance, siteKey, readProjection, signal } = request;
		this.controllers.get(key)?.abort();
		const controller = new AbortController();
		this.controllers.set(key, controller);
		const onLifecycleAbort = (): void => controller.abort();
		signal?.addEventListener('abort', onLifecycleAbort, { once: true });
		void (async (): Promise<void> => {
			try {
				const deadline = performance.now() + PROJECTION_AUDIT_BUDGET_MS;
				let seen: ControlValues[RestorableMediaField] | null = null;
				let agreed = false;
				while (performance.now() < deadline) {
					if (controller.signal.aborted) return;
					seen = readProjection();
					if (seen !== null && nativeValuesMatch(desired, seen, tolerance)) {
						agreed = true;
						break;
					}
					await new Promise<void>((resolve) => { setTimeout(resolve, PROJECTION_AUDIT_INTERVAL_MS); });
				}
				if (controller.signal.aborted) return;
				// An unreadable badge says nothing; only a readable, disagreeing one
				// is evidence that the UI did not follow.
				if (seen === null) {
					recordNativeWriteOutcome(siteKey, 'unconfirmed');
					return;
				}
				recordNativeWriteOutcome(siteKey, agreed ? 'confirmed' : 'drifted');
			} catch {
				// A projection reader that throws is a broken witness, not a bounced
				// write. `unconfirmed` records exactly that and cannot demote a site.
				if (!controller.signal.aborted) recordNativeWriteOutcome(siteKey, 'unconfirmed');
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
