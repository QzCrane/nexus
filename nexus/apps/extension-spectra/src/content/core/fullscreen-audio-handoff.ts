// goal: serialize short native-audio handoffs around fullscreen requests

import type { CaptureManager } from '../audio/capture-manager';
import type { WebAudioController } from '@nexus/audio-engine';
import type { PolicyExecutor } from '../logic/policy-executor';
import type { PolicyExecutorState } from '../types';
import { logger } from '../../shared/logger';
import {
	SPECTRA_FULLSCREEN_BRIDGE_READY_ATTRIBUTE,
	SPECTRA_FULLSCREEN_FINISH_EVENT,
	SPECTRA_FULLSCREEN_PREPARE_EVENT,
	SPECTRA_FULLSCREEN_READY_EVENT,
	SPECTRA_FULLSCREEN_REQUEST_ATTRIBUTE,
	SPECTRA_FULLSCREEN_RESULT_ATTRIBUTE,
	isSpectraFullscreenRequestId,
	type SpectraFullscreenBridgeMessage,
} from '../../shared/fullscreen-bridge';

const log = logger.content;
const FINISHED_BEFORE_READY_LIMIT = 8;
const FINISHED_BEFORE_READY_TTL_MS = 2_000;

export interface FullscreenAudioHandoff {
	run<T>(operation: () => Promise<T>): Promise<T>;
	dispose(): void;
}

interface FullscreenAudioHandoffDeps {
	state: PolicyExecutorState;
	policyExecutor: PolicyExecutor;
	captureManager: CaptureManager;
	audioController: WebAudioController;
}

type AudioSuspension = {
	kind: 'capture';
	continuation: NonNullable<Awaited<ReturnType<CaptureManager['suspendForContinuation']>>>;
	mode: PolicyExecutorState['activeMode'];
} | { kind: 'webaudio' };

function decodeRequest(): SpectraFullscreenBridgeMessage | null {
	const encoded = document.documentElement?.getAttribute(SPECTRA_FULLSCREEN_REQUEST_ATTRIBUTE);
	if (!encoded) return null;
	try {
		const value = JSON.parse(encoded) as Partial<SpectraFullscreenBridgeMessage>;
		return isSpectraFullscreenRequestId(value.requestId)
			? { requestId: value.requestId }
			: null;
	} catch {
		return null;
	}
}

export function createFullscreenAudioHandoff(
	deps: FullscreenAudioHandoffDeps,
): FullscreenAudioHandoff {
	let suspension: Promise<AudioSuspension | null> | null = null;
	let suspensionUsers = 0;
	let disposed = false;
	const pending = new Map<string, Promise<() => Promise<void>>>();
	const finishedBeforeReady = new Map<string, number>();
	let currentRequestId: string | null = null;
	let finishedBeforeReadyTimer: ReturnType<typeof setTimeout> | null = null;

	const pruneFinishedBeforeReady = (): void => {
		const cutoff = Date.now() - FINISHED_BEFORE_READY_TTL_MS;
		for (const [requestId, createdAt] of finishedBeforeReady) {
			if (createdAt < cutoff) finishedBeforeReady.delete(requestId);
		}
		if (finishedBeforeReady.size === 0 && finishedBeforeReadyTimer !== null) {
			clearTimeout(finishedBeforeReadyTimer);
			finishedBeforeReadyTimer = null;
		}
		if (finishedBeforeReady.size === 0 && pending.size === 0) currentRequestId = null;
	};

	const scheduleFinishedBeforeReadyPrune = (): void => {
		if (finishedBeforeReadyTimer !== null || disposed || finishedBeforeReady.size === 0) return;
		finishedBeforeReadyTimer = setTimeout(() => {
			finishedBeforeReadyTimer = null;
			pruneFinishedBeforeReady();
			scheduleFinishedBeforeReadyPrune();
		}, FINISHED_BEFORE_READY_TTL_MS + 1);
	};

	const suspend = async (): Promise<AudioSuspension | null> => {
		const captureActive = deps.captureManager.isActive()
			|| deps.state.actualMode === 'capture';
		const webAudioActive = deps.state.actualMode === 'webaudio';
		if (!captureActive && !webAudioActive) return null;
		if (webAudioActive) {
			await deps.audioController.bypass();
			deps.state.actualMode = 'bypass';
			deps.state.phase = 'idle';
			return { kind: 'webaudio' };
		}

		await deps.captureManager.waitForSettled();
		if (!deps.captureManager.isActive()) {
			throw new Error('Capture lifecycle had no active processor to hand off');
		}
		const continuation = await deps.captureManager.suspendForContinuation(
			deps.state.config,
			deps.state.generation + 1,
		);
		if (!continuation) throw new Error('Capture did not create a fullscreen continuation');
		deps.state.generation = Math.max(
			deps.state.generation,
			deps.captureManager.getGeneration(),
		);
		deps.state.actualMode = 'bypass';
		deps.state.phase = 'idle';
		return { kind: 'capture', continuation, mode: deps.state.activeMode };
	};

	const restore = async (suspended: AudioSuspension | null): Promise<void> => {
		if (!suspended || disposed) return;
		deps.state.userHasInteracted = true;
		if (suspended.kind === 'capture' && deps.state.activeMode === suspended.mode) {
			const result = await suspended.continuation.resume(
				deps.state.config,
				deps.state.generation + 1,
			);
			deps.state.generation = Math.max(deps.state.generation, result.generation ?? 0);
			deps.state.actualMode = 'capture';
			deps.state.phase = 'active';
			deps.state.lastError = undefined;
			const actual = result.actualConfig ?? deps.captureManager.getActualConfig();
			if (actual) deps.state.appliedConfig = { ...actual, eqValues: [...actual.eqValues] };
		}
		await deps.policyExecutor.applyState({ modeIntent: true });
	};

	const acquire = async (): Promise<() => Promise<void>> => {
		suspensionUsers += 1;
		if (!suspension) {
			suspension = suspend().catch((error) => {
				log.warn('[Fullscreen] Audio handoff failed; continuing with native fullscreen', error);
				return null;
			});
		}
		const currentSuspension = suspension;
		// READY means the old processor has actually yielded, not merely that the
		// transition was scheduled. This preserves the original fullscreen gesture
		// while preventing the browser from racing an in-flight Capture stop.
		await currentSuspension;
		let released = false;
		return async () => {
			if (released) return;
			released = true;
			suspensionUsers = Math.max(0, suspensionUsers - 1);
			if (suspensionUsers > 0 || suspension !== currentSuspension) return;
			suspension = null;
			await restore(await currentSuspension).catch((error) => {
				log.warn('[Fullscreen] Audio restore failed', error);
			});
		};
	};

	const onPrepare = (): void => {
		pruneFinishedBeforeReady();
		const request = decodeRequest();
		if (!request || pending.has(request.requestId)) return;
		// A prepare event establishes the sole current operation. A finish event
		// for another id cannot retire or enqueue work for this handoff.
		currentRequestId = request.requestId;
		const release = acquire();
		pending.set(request.requestId, release);
		void release.then(async (releaseAudio) => {
			if (disposed || finishedBeforeReady.delete(request.requestId)) {
				pending.delete(request.requestId);
				await releaseAudio();
				return;
			}
			document.documentElement.setAttribute(
				SPECTRA_FULLSCREEN_RESULT_ATTRIBUTE,
				JSON.stringify(request),
			);
			document.dispatchEvent(new Event(SPECTRA_FULLSCREEN_READY_EVENT));
		});
	};

	const onFinish = (): void => {
		pruneFinishedBeforeReady();
		const request = decodeRequest();
		if (!request) return;
		const release = pending.get(request.requestId);
		if (!release) {
			if (currentRequestId !== null && currentRequestId !== request.requestId) return;
			currentRequestId = request.requestId;
			if (finishedBeforeReady.size >= FINISHED_BEFORE_READY_LIMIT) {
				const oldest = finishedBeforeReady.keys().next().value;
				if (typeof oldest === 'string') finishedBeforeReady.delete(oldest);
			}
			finishedBeforeReady.set(request.requestId, Date.now());
			scheduleFinishedBeforeReadyPrune();
			return;
		}
		pending.delete(request.requestId);
		void release.then((releaseAudio) => releaseAudio());
	};

	document.documentElement?.setAttribute(SPECTRA_FULLSCREEN_BRIDGE_READY_ATTRIBUTE, 'true');
	document.addEventListener(SPECTRA_FULLSCREEN_PREPARE_EVENT, onPrepare);
	document.addEventListener(SPECTRA_FULLSCREEN_FINISH_EVENT, onFinish);

	return {
		async run<T>(operation: () => Promise<T>): Promise<T> {
			const release = await acquire();
			try {
				return await operation();
			} finally {
				await release();
			}
		},
		dispose(): void {
			if (disposed) return;
			disposed = true;
			document.removeEventListener(SPECTRA_FULLSCREEN_PREPARE_EVENT, onPrepare);
			document.removeEventListener(SPECTRA_FULLSCREEN_FINISH_EVENT, onFinish);
			document.documentElement?.removeAttribute(SPECTRA_FULLSCREEN_BRIDGE_READY_ATTRIBUTE);
			if (finishedBeforeReadyTimer !== null) clearTimeout(finishedBeforeReadyTimer);
			finishedBeforeReadyTimer = null;
			for (const release of pending.values()) {
				void release.then((releaseAudio) => releaseAudio());
			}
			pending.clear();
			finishedBeforeReady.clear();
			currentRequestId = null;
		},
	};
}
