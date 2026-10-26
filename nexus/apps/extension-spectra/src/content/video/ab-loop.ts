// goal: source-scoped A/B playback with one bounded scheduler and one seek owner

import type { MediaTarget } from '@nexus/contracts';
import { createLogger } from '../../shared/logger';
import { getActiveMediaRegistry, type MediaRegistry } from '../core/media-registry';
import {
	ContentLifecycleError,
	isContentLifecycleError,
} from '../core/content-runtime-context';
import { seekNativeMedia } from '../logic/native-media-async';

const log = createLogger('ABLoop');
const MINIMUM_LOOP_SECONDS = 0.1;
const FRAME_WINDOW_SECONDS = 0.12;

interface ABState {
	target: MediaTarget;
	element: HTMLMediaElement;
	pointA: number;
	pointB: number | null;
	enabled: boolean;
	timerId: ReturnType<typeof setTimeout> | null;
	frameFallbackTimerId: ReturnType<typeof setTimeout> | null;
	frameId: number | null;
	disposeListeners: (() => void) | null;
	seeking: boolean;
	skipSuppressed: boolean;
	seekController: AbortController | null;
}

const states = new Map<string, ABState>();
let releaseReporter: ((target: MediaTarget) => void) | null = null;

function sourceKey(target: MediaTarget): string {
	return `${target.documentId}:${target.mediaId}:${target.sourceRevision}`;
}

function active(target: MediaTarget | null = null): { element: HTMLMediaElement; target: MediaTarget; key: string } | null {
	const registry = getActiveMediaRegistry();
	const resolved = registry?.resolve(target);
	if (!registry || !resolved) return null;
	const valid = new Set(registry.list().map(({ target }) => sourceKey(target)));
	for (const [key, state] of states) {
		if (valid.has(key)) continue;
		disposeState(state);
		states.delete(key);
	}
	return { ...resolved, key: sourceKey(resolved.target) };
}

function clearSchedule(state: ABState): void {
	if (state.timerId !== null) clearTimeout(state.timerId);
	state.timerId = null;
	if (state.frameFallbackTimerId !== null) clearTimeout(state.frameFallbackTimerId);
	state.frameFallbackTimerId = null;
	if (state.frameId !== null && state.element instanceof HTMLVideoElement
		&& typeof state.element.cancelVideoFrameCallback === 'function') {
		state.element.cancelVideoFrameCallback(state.frameId);
	}
	state.frameId = null;
}

function disposeState(
	state: ABState,
	reason: 'cancelled' | 'stale-media-source' = 'cancelled',
): void {
	clearSchedule(state);
	state.seekController?.abort(new ContentLifecycleError(reason, 'A/B source operation was disposed'));
	state.seekController = null;
	state.disposeListeners?.();
	state.disposeListeners = null;
	state.enabled = false;
}

function retireState(
	state: ABState,
	report: boolean,
	reason: 'cancelled' | 'stale-media-source' = 'cancelled',
): void {
	const key = sourceKey(state.target);
	if (states.get(key) !== state) return;
	disposeState(state, reason);
	states.delete(key);
	if (report) releaseReporter?.({ ...state.target });
}

function stillCurrent(state: ABState): boolean {
	return getActiveMediaRegistry()?.resolve(state.target)?.element === state.element;
}

async function loopToA(state: ABState): Promise<void> {
	if (state.seeking || !state.enabled || !stillCurrent(state)) return;
	state.seeking = true;
	clearSchedule(state);
	const controller = new AbortController();
	state.seekController = controller;
	try {
		await seekNativeMedia(state.element, state.pointA, 0.05, {
			signal: controller.signal,
			isCurrent: () => stillCurrent(state),
		});
		if (!stillCurrent(state)) {
			throw new ContentLifecycleError('stale-media-source', 'A/B source changed during boundary seek');
		}
		log.info(`Loop A (${state.pointA.toFixed(2)}s)`);
	} catch (error) {
		if (isContentLifecycleError(error)
			&& error.code === 'cancelled'
			&& (controller !== state.seekController || !state.enabled)) return;
		log.warn('A/B boundary seek failed', error);
		retireState(state, true, isContentLifecycleError(error) && error.code === 'stale-media-source'
			? 'stale-media-source'
			: 'cancelled');
	} finally {
		if (state.seekController === controller) state.seekController = null;
		state.seeking = false;
		arm(state);
	}
}

function armVideoFrame(state: ABState, video: HTMLVideoElement): void {
	if (state.frameId !== null) return;
	const pointB = state.pointB;
	if (pointB === null) return;
	const rate = Math.max(0.1, Math.abs(video.playbackRate || 1));
	const remaining = Math.max(0, pointB - video.currentTime);
	// rVFC can stop while a tab is hidden. Keep one bounded timer in parallel so
	// the loop boundary remains live without any idle polling.
	state.frameFallbackTimerId = setTimeout(() => {
		state.frameFallbackTimerId = null;
		if (state.frameId !== null && typeof video.cancelVideoFrameCallback === 'function') {
			video.cancelVideoFrameCallback(state.frameId);
			state.frameId = null;
		}
		arm(state);
	}, Math.max(24, remaining / rate * 1_000 + 24));
	state.frameId = video.requestVideoFrameCallback((_now, metadata) => {
		state.frameId = null;
		if (state.frameFallbackTimerId !== null) clearTimeout(state.frameFallbackTimerId);
		state.frameFallbackTimerId = null;
		if (!state.enabled || !stillCurrent(state)) return;
		const pointB = state.pointB;
		if (pointB === null) return;
		const mediaTime = Number.isFinite(metadata.mediaTime) ? metadata.mediaTime : video.currentTime;
		if (mediaTime >= pointB - 0.005) void loopToA(state);
		else arm(state);
	});
}

function arm(state: ABState): void {
	clearSchedule(state);
	if (!state.enabled || state.pointB === null || state.element.paused || state.element.ended) return;
	if (!stillCurrent(state)) {
		retireState(state, true);
		return;
	}
	const rate = Math.max(0.1, Math.abs(state.element.playbackRate || 1));
	const remaining = state.pointB - state.element.currentTime;
	if (state.skipSuppressed) {
		if (remaining > 0.005) state.skipSuppressed = false;
		else return;
	}
	if (remaining <= 0.005) {
		void loopToA(state);
		return;
	}
	if (state.element instanceof HTMLVideoElement
		&& typeof state.element.requestVideoFrameCallback === 'function'
		&& remaining <= FRAME_WINDOW_SECONDS * rate) {
		armVideoFrame(state, state.element);
		return;
	}
	const delayMs = Math.max(16, (remaining / rate - FRAME_WINDOW_SECONDS) * 1_000);
	state.timerId = setTimeout(() => {
		state.timerId = null;
		arm(state);
	}, delayMs);
}

function bind(state: ABState): void {
	if (state.disposeListeners) return;
	const rearm = () => {
		if (state.pointB !== null && state.element.currentTime < state.pointB - 0.005) {
			state.skipSuppressed = false;
		}
		arm(state);
	};
	const stop = () => clearSchedule(state);
	const invalidate = () => {
		retireState(state, true, 'stale-media-source');
	};
	for (const type of ['play', 'seeked', 'ratechange'] as const) {
		state.element.addEventListener(type, rearm);
	}
	for (const type of ['pause', 'ended'] as const) state.element.addEventListener(type, stop);
	for (const type of ['emptied', 'loadstart'] as const) state.element.addEventListener(type, invalidate);
	state.disposeListeners = () => {
		for (const type of ['play', 'seeked', 'ratechange'] as const) {
			state.element.removeEventListener(type, rearm);
		}
		for (const type of ['pause', 'ended'] as const) state.element.removeEventListener(type, stop);
		for (const type of ['emptied', 'loadstart'] as const) state.element.removeEventListener(type, invalidate);
	};
	arm(state);
}

export function setPointA(target: MediaTarget | null = null): number | null {
	const context = active(target);
	if (!context) return null;
	const pointA = context.element.currentTime;
	const duration = context.element.duration;
	if (!Number.isFinite(pointA) || pointA < 0
		|| Number.isFinite(duration) && (duration < 0 || pointA > duration)) {
		throw new Error('A/B point A is outside the current media timeline');
	}
	const previous = states.get(context.key);
	if (previous) retireState(previous, false);
	const state: ABState = {
		target: { ...context.target },
		element: context.element,
		pointA,
		pointB: null,
		enabled: false,
		timerId: null,
		frameFallbackTimerId: null,
		frameId: null,
		disposeListeners: null,
		seeking: false,
		skipSuppressed: false,
		seekController: null,
	};
	states.set(context.key, state);
	log.info(`Set A: ${state.pointA.toFixed(2)}s`);
	return state.pointA;
}

export function setPointB(target: MediaTarget | null = null): { pointB: number | null; looping: boolean } {
	const context = active(target);
	const state = context && states.get(context.key);
	if (!context || !state || state.element !== context.element) {
		return { pointB: null, looping: false };
	}
	const pointB = context.element.currentTime;
	const duration = context.element.duration;
	if (!Number.isFinite(pointB) || pointB < 0
		|| Number.isFinite(duration) && (duration < 0 || pointB > duration)
		|| pointB - state.pointA < MINIMUM_LOOP_SECONDS) {
		return { pointB: null, looping: false };
	}
	state.pointB = pointB;
	state.enabled = true;
	bind(state);
	log.info(`Set B: ${pointB.toFixed(2)}s`);
	return { pointB, looping: true };
}

export function clearABLoop(target: MediaTarget | null = null): boolean {
	const context = active(target);
	if (!context) return false;
	const state = states.get(context.key);
	if (!state) return false;
	retireState(state, false);
	return true;
}

export function getABState(target: MediaTarget | null = null): { pointA: number | null; pointB: number | null; looping: boolean } {
	const context = active(target);
	const state = context && states.get(context.key);
	return state
		? { pointA: state.pointA, pointB: state.pointB, looping: state.enabled }
		: { pointA: null, pointB: null, looping: false };
}

export function listABOwnership(): Array<{ target: MediaTarget; active: boolean }> {
	return [...states.values()].map((state) => ({
		target: { ...state.target },
		active: state.enabled,
	}));
}

export async function skipABLoop(target: MediaTarget | null = null): Promise<number | null> {
	const context = active(target);
	const state = context && states.get(context.key);
	if (!context || !state || state.pointB === null) return null;
	state.skipSuppressed = true;
	clearSchedule(state);
	state.seekController?.abort(new ContentLifecycleError('cancelled', 'A/B skip superseded the prior seek'));
	const controller = new AbortController();
	state.seekController = controller;
	try {
		const currentTime = await seekNativeMedia(context.element, state.pointB + 0.05, 0.05, {
			signal: controller.signal,
			isCurrent: () => stillCurrent(state),
		});
		if (!stillCurrent(state)) {
			throw new ContentLifecycleError('stale-media-source', 'A/B source changed during skip');
		}
		// Playback is now past B, so this loop will never arm again. Leaving
		// `enabled` set made every projection report a loop that cannot fire while
		// `skipSuppressed` blocked the only code path that would have noticed
		// (SP-76). Ending the loop here keeps the report and the behaviour equal.
		retireState(state, true);
		return currentTime;
	} catch (error) {
		if (isContentLifecycleError(error)) {
			if (error.code === 'stale-media-source') retireState(state, true);
			throw error;
		}
		state.skipSuppressed = false;
		arm(state);
		throw error;
	} finally {
		if (state.seekController === controller) state.seekController = null;
	}
}

export function disposeABLoops(): void {
	for (const state of states.values()) disposeState(state);
	states.clear();
}

export function setABLoopReleaseReporter(
	reporter: ((target: MediaTarget) => void) | null,
): () => void {
	releaseReporter = reporter;
	return () => {
		if (releaseReporter === reporter) releaseReporter = null;
	};
}

export function disposeABLoopSource(target: MediaTarget): boolean {
	const key = sourceKey(target);
	const state = states.get(key);
	if (!state) return false;
	retireState(state, false, 'stale-media-source');
	return true;
}

// A source revision is a new playback identity even when the page reuses the
// same element. Subscribe to the registry's logical `removed` event so a
// paused loop cannot retain listeners or a dormant timer until another A/B
// command happens to run.
export function observeABLoopSources(
	registry: MediaRegistry,
	onReleased?: (target: MediaTarget) => void,
): () => void {
	const disposeReporter = setABLoopReleaseReporter(onReleased ?? null);
	const unsubscribe = registry.subscribe((target, event) => {
		if (event !== 'removed') return;
		const key = sourceKey(target);
		const state = states.get(key);
		if (!state) return;
		// The registry-level typed lifecycle message clears the Background owner
		// exactly once. The reporter remains reserved for runtime failures that do
		// not remove the media source.
		disposeABLoopSource(target);
	});
	return () => {
		unsubscribe();
		disposeReporter();
	};
}

export const abLoopTestApi = {
	sourceCount: (): number => states.size,
};
