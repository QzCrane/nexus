// goal: own every bounded asynchronous native-media acknowledgement and seek

import {
	abortError,
	assertNotAborted,
	ContentLifecycleError,
} from '../core/content-runtime-context';

/**
 * A native-media operation is valid only while its caller's signal and target
 * fence are both current.  Callers must pass the same options through every
 * await so a late event/readback cannot become a successful ACK.
 */
export interface NativeMediaOperationOptions {
	signal?: AbortSignal;
	isCurrent?: () => boolean;
	timeoutMs?: number;
}

export function assertNativeOperationCurrent(options: NativeMediaOperationOptions): void {
	assertNotAborted(options.signal);
	if (options.isCurrent && !options.isCurrent()) {
		throw new ContentLifecycleError(
			'stale-media-source',
			'The media source changed before the asynchronous native operation committed',
		);
	}
}

interface OwnedSeek {
	expected: number;
	tolerance: number;
	expiresAt: number;
}

const ownedSeeks = new WeakMap<HTMLMediaElement, OwnedSeek[]>();
const videoCadence = new WeakMap<HTMLVideoElement, {
	sourceRevision: number;
	frameDuration: number;
}>();

function markOwnedSeek(
	element: HTMLMediaElement,
	expected: number,
	tolerance: number,
): OwnedSeek {
	const now = performance.now();
	const active = (ownedSeeks.get(element) ?? [])
		.filter((seek) => seek.expiresAt > now);
	const owned = { expected, tolerance, expiresAt: now + 1_000 };
	active.push(owned);
	ownedSeeks.set(element, active);
	return owned;
}

function releaseOwnedSeek(element: HTMLMediaElement, owned: OwnedSeek): void {
	const active = (ownedSeeks.get(element) ?? []).filter((seek) => seek !== owned);
	if (active.length > 0) ownedSeeks.set(element, active);
	else ownedSeeks.delete(element);
}

/** Consume only a seek token owned by this module and this exact element. */
export function consumeOwnedSeek(element: HTMLMediaElement, actual: number): boolean {
	const now = performance.now();
	const active = (ownedSeeks.get(element) ?? [])
		.filter((seek) => seek.expiresAt > now);
	const index = active.findIndex((seek) => Math.abs(seek.expected - actual) <= seek.tolerance);
	if (index < 0) {
		if (active.length > 0) ownedSeeks.set(element, active);
		else ownedSeeks.delete(element);
		return false;
	}
	active.splice(index, 1);
	if (active.length > 0) ownedSeeks.set(element, active);
	else ownedSeeks.delete(element);
	return true;
}

/**
 * A site may set `disablePictureInPicture` as a UI preference. An explicit
 * extension request lifts it for the native call, but it must not be restored
 * while the session is live: W3C Picture-in-Picture §3.4 lets the user agent
 * run the exit-Picture-in-Picture algorithm when the attribute is *added* to
 * the element that is already the `pictureInPictureElement`, and Chrome does
 * exactly that. Restoring it in a `finally` therefore closes the window the
 * request just opened, and the stable readback then reports a mismatch that
 * looks like a page failure. Ownership transfers to the session instead: the
 * attribute returns to the site when the session ends.
 */
const liftedPictureInPictureDisable = new WeakMap<HTMLVideoElement, () => void>();

export function holdPictureInPictureDisable(element: HTMLVideoElement): void {
	releasePictureInPictureDisable(element);
	const release = (): void => {
		element.removeEventListener('leavepictureinpicture', release);
		if (liftedPictureInPictureDisable.get(element) !== release) return;
		liftedPictureInPictureDisable.delete(element);
		// The element is no longer the PiP owner here, so re-adding the attribute
		// cannot run the exit algorithm.
		element.disablePictureInPicture = true;
	};
	liftedPictureInPictureDisable.set(element, release);
	element.addEventListener('leavepictureinpicture', release, { once: true });
}

/** Retire the lift without closing a session the viewer owns. */
export function releasePictureInPictureDisable(element: HTMLVideoElement): void {
	const release = liftedPictureInPictureDisable.get(element);
	if (!release) return;
	element.removeEventListener('leavepictureinpicture', release);
	liftedPictureInPictureDisable.delete(element);
	if (document.pictureInPictureElement === element) {
		// Teardown must never close a live session. Keep the ownership so the
		// attribute still returns to the site at the session's real end.
		liftedPictureInPictureDisable.set(element, release);
		element.addEventListener('leavepictureinpicture', release, { once: true });
		return;
	}
	element.disablePictureInPicture = true;
}

/** Retire all async state when an element's media source identity ends. */
export function clearNativeMediaAsyncState(element: HTMLMediaElement): void {
	ownedSeeks.delete(element);
	if (typeof HTMLVideoElement !== 'undefined' && element instanceof HTMLVideoElement) {
		videoCadence.delete(element);
		releasePictureInPictureDisable(element);
	}
}

export function nativeValuesMatch(expected: unknown, actual: unknown, tolerance: number): boolean {
	if (typeof expected === 'number' && typeof actual === 'number') {
		return Math.abs(expected - actual) <= tolerance;
	}
	return JSON.stringify(expected) === JSON.stringify(actual);
}

const ANIMATION_BOUNDARY_FALLBACK_MS = 48;

function nextAnimationBoundary(options: NativeMediaOperationOptions = {}): Promise<void> {
	assertNativeOperationCurrent(options);
	if (typeof requestAnimationFrame !== 'function') return Promise.resolve();
	return new Promise((resolve, reject) => {
		let settled = false;
		let frameId: number | undefined;
		let timeoutId: ReturnType<typeof setTimeout> | null = null;
		const finish = (error?: ContentLifecycleError): void => {
			if (settled) return;
			settled = true;
			if (timeoutId !== null) clearTimeout(timeoutId);
			options.signal?.removeEventListener('abort', onAbort);
			if (frameId !== undefined && typeof cancelAnimationFrame === 'function') {
				cancelAnimationFrame(frameId);
			}
			if (error) reject(error);
			else resolve();
		};
		const onAbort = (): void => finish(abortError(options.signal));
		// Hidden/background tabs may suspend rAF indefinitely. Preserve a bounded
		// fallback, while an explicit lifecycle abort rejects immediately.
		timeoutId = setTimeout(finish, options.timeoutMs ?? ANIMATION_BOUNDARY_FALLBACK_MS);
		options.signal?.addEventListener('abort', onAbort, { once: true });
		frameId = requestAnimationFrame(() => finish());
	});
}

export async function stableReadback<T>(
	read: () => T,
	options: NativeMediaOperationOptions = {},
): Promise<T> {
	assertNativeOperationCurrent(options);
	// Page players commonly reflect a standard setter synchronously and then
	// normalize it in a microtask or animation callback. Two bounded frame
	// boundaries catch that rollback without installing a standing observer.
	await Promise.resolve();
	assertNativeOperationCurrent(options);
	await nextAnimationBoundary(options);
	assertNativeOperationCurrent(options);
	await nextAnimationBoundary(options);
	assertNativeOperationCurrent(options);
	return read();
}

const NATIVE_EVENT_QUIET_MS = 64;

export async function stablePageReadback<T>(
	read: () => T,
	options: NativeMediaOperationOptions = {},
): Promise<T> {
	// Page controller getters are the ACK boundary. Give the player the same
	// short quiet window used by native event ACKs, then cross two render
	// boundaries so delayed UI/state rollback cannot be committed as success.
	assertNativeOperationCurrent(options);
	await waitWithNativeTimeout(NATIVE_EVENT_QUIET_MS, options);
	return stableReadback(read, options);
}

/** Native playback changes paused synchronously; a page can stop event delivery.
 * The physical getter, stable boundary and exact selection fence own this ACK.
 * A pending play Promise cannot block a later pause, and a real replay is an
 * error rather than an invitation to repeatedly force the page to pause. */
export async function writePlaybackWithStableAck(
	element: HTMLMediaElement,
	playing: boolean,
	options: NativeMediaOperationOptions = {},
): Promise<boolean> {
	assertNativeOperationCurrent(options);
	const written = Promise.resolve(!element.paused === playing
		? undefined : playing ? element.play() : element.pause());
	const afterWrite = !element.paused;
	const proof = stablePageReadback(() => !element.paused, options);
	const actual = await Promise.race([written.then(() => proof), proof]);
	assertNativeOperationCurrent(options);
	if (actual !== playing) {
		throw new Error(`Playback readback mismatch: requested playing=${playing}; after write=${afterWrite}; stable=${actual}`);
	}
	return actual;
}

function waitWithNativeTimeout(
	timeoutMs: number,
	options: NativeMediaOperationOptions = {},
): Promise<void> {
	assertNativeOperationCurrent(options);
	return new Promise((resolve, reject) => {
		let settled = false;
		let timeoutId: ReturnType<typeof setTimeout> | null = null;
		const finish = (error?: ContentLifecycleError): void => {
			if (settled) return;
			settled = true;
			if (timeoutId !== null) clearTimeout(timeoutId);
			options.signal?.removeEventListener('abort', onAbort);
			if (error) reject(error);
			else resolve();
		};
		const onAbort = (): void => finish(abortError(options.signal));
		timeoutId = setTimeout(finish, timeoutMs);
		options.signal?.addEventListener('abort', onAbort, { once: true });
	});
}

export async function writeWithStableEventAck<T>(
	target: EventTarget,
	type: string,
	write: () => unknown | Promise<unknown>,
	read: () => T,
	expected: unknown,
	tolerance: number,
	timeoutMs = 750,
	options: NativeMediaOperationOptions = {},
): Promise<T> {
	assertNativeOperationCurrent(options);
	if (nativeValuesMatch(expected, read(), tolerance)) {
		// The native field already exposes the requested value. Re-read across
		// the same stabilization boundary instead of causing an unnecessary
		// setter side effect with no authoritative event to acknowledge it.
		return stableReadback(read, options);
	}
	let finish!: (matched: boolean) => void;
	let quietTimer: ReturnType<typeof setTimeout> | null = null;
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	let abortListener: (() => void) | null = null;
	let cancellation: ContentLifecycleError | null = null;
	const acknowledgement = new Promise<boolean>((resolve) => {
		finish = resolve;
	});
	const onEvent = (): void => {
		if (quietTimer !== null) clearTimeout(quietTimer);
		quietTimer = null;
		if (!nativeValuesMatch(expected, read(), tolerance)) return;
		// A page-player setter can acknowledge our value and restore its own value
		// in a timer. Require one short event-quiet window before committing.
		quietTimer = setTimeout(() => finish(true), NATIVE_EVENT_QUIET_MS);
	};
	target.addEventListener(type, onEvent);
	if (options.signal) {
		abortListener = () => {
			cancellation = abortError(options.signal);
			finish(false);
		};
		options.signal.addEventListener('abort', abortListener, { once: true });
	}
	timeoutId = setTimeout(() => finish(false), timeoutMs);
	try {
		// The event/getter proof owns completion, including while play() is still
		// waiting for data. Race the write rejection against that proof so timeout
		// and lifecycle cancellation also bound a never-settling native Promise.
		// Promise.race retains its rejection handler after the proof wins (e.g. a
		// later pause rejects the pending play Promise with AbortError).
		const written = Promise.resolve(write());
		const matched = await Promise.race([written.then(() => acknowledgement), acknowledgement]);
		assertNativeOperationCurrent(options);
		if (cancellation) throw cancellation;
		if (!matched) {
			if (cancellation) throw cancellation;
			assertNativeOperationCurrent(options);
			throw new Error(`Native ${type} event readback did not acknowledge the requested value`);
		}
		assertNativeOperationCurrent(options);
		return await stableReadback(read, options);
	} finally {
		target.removeEventListener(type, onEvent);
		if (quietTimer !== null) clearTimeout(quietTimer);
		if (timeoutId !== null) clearTimeout(timeoutId);
		if (options.signal && abortListener) options.signal.removeEventListener('abort', abortListener);
	}
}

const SPEED_SETTLE_POLL_MS = 32;

/**
 * Settle a speed write on its value, not on `ratechange` alone.
 *
 * A source change can reset `playbackRate` synchronously without leaving an
 * event that acknowledges the requested value. An event-gated ACK then reports
 * a misleading timeout even when a same-source write is already stable. Poll
 * the actual value through a short quiet window instead, then cross the normal
 * render boundaries to catch a delayed page rollback.
 *
 * This helper deliberately never rewrites after a source change. The executor's
 * `isCurrent` fence cancels the old-source operation; the registry's new-source
 * replay is the only path allowed to restore the desired rate. That keeps one
 * intent from writing two different resources and preserves page/user gestures.
 */
export async function writeSpeedWithSettleAck<T>(
	write: () => unknown | Promise<unknown>,
	read: () => T,
	expected: unknown,
	tolerance: number,
	timeoutMs = 750,
	options: NativeMediaOperationOptions = {},
): Promise<T> {
	assertNativeOperationCurrent(options);
	const deadline = performance.now() + timeoutMs;
	let quietSince = 0;
	await write();
	assertNativeOperationCurrent(options);
	while (performance.now() < deadline) {
		assertNativeOperationCurrent(options);
		const actual = read();
		if (nativeValuesMatch(expected, actual, tolerance)) {
			// A page player can acknowledge and restore its own value in a timer.
			// One short quiet window separates "settled" from "about to bounce".
			if (quietSince === 0) quietSince = performance.now();
			else if (performance.now() - quietSince >= NATIVE_EVENT_QUIET_MS) {
				return stableReadback(read, options);
			}
		} else {
			quietSince = 0;
		}
		await waitWithNativeTimeout(
			Math.min(SPEED_SETTLE_POLL_MS, Math.max(0, deadline - performance.now())),
			options,
		);
	}
	assertNativeOperationCurrent(options);
	const actual = read();
	if (nativeValuesMatch(expected, actual, tolerance)) return stableReadback(read, options);
	throw new Error('Native speed readback did not settle on the requested value');
}

/**
 * Observe an *already written* native field across the same stabilization
 * boundary a write would pay, without invoking a second setter.
 *
 * This exists because the split-ack path performs the physical write inside the
 * transaction and defers the proof. A plain `stableReadback` would skip the
 * event-quiet window, which is the part that actually catches a page player
 * acknowledging a value and restoring its own in a timer — so the deferred
 * proof would be strictly weaker than the one it replaced.
 *
 * `type` accepts every event that can announce the field's change, because one
 * event is not always enough to prove a session: `playing` settles on either
 * `play` or `pause`, and PiP settles in both directions. Registering only one
 * would turn the other half of the same truth into a 750ms timeout.
 *
 * Resolving `matched` (rather than throwing) is deliberate: the caller is no
 * longer in a position to fail the transaction, so a rollback becomes a
 * reportable observation instead of an error.
 */
export async function confirmStableNativeEvent<T>(
	target: EventTarget,
	type: string | readonly string[],
	read: () => T,
	expected: T,
	tolerance: number,
	timeoutMs = 750,
	options: NativeMediaOperationOptions = {},
): Promise<{ actual: T; matched: boolean }> {
	assertNativeOperationCurrent(options);
	const types = typeof type === 'string' ? [type] : [...type];
	if (types.length === 0) throw new Error('A native confirmation needs at least one event to observe');
	let finish!: (matched: boolean) => void;
	let quietTimer: ReturnType<typeof setTimeout> | null = null;
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	let abortListener: (() => void) | null = null;
	let cancellation: ContentLifecycleError | null = null;
	const settled = new Promise<boolean>((resolve) => {
		finish = resolve;
	});
	const onEvent = (): void => {
		if (quietTimer !== null) clearTimeout(quietTimer);
		// Restart the quiet window on every event instead of judging on the
		// first one: a player that reports an intermediate value on its way back
		// must still be caught once it settles.
		quietTimer = setTimeout(
			() => finish(nativeValuesMatch(expected, read(), tolerance)),
			NATIVE_EVENT_QUIET_MS,
		);
	};
	for (const each of types) target.addEventListener(each, onEvent);
	if (options.signal) {
		abortListener = () => {
			cancellation = abortError(options.signal);
			finish(false);
		};
		options.signal.addEventListener('abort', abortListener, { once: true });
	}
	// A caller proving its own write is looking at a value that is already in
	// place. Waiting for the next event would then cost the full timeout: PiP and
	// playback both settle their event *before* their Promise resolves, so the
	// proof is always attached after the announcement it would be waiting for.
	// When the value is not there yet (a page controller that applies later),
	// nothing starts and the event — or the deadline read — decides.
	if (nativeValuesMatch(expected, read(), tolerance)) onEvent();
	timeoutId = setTimeout(
		() => finish(nativeValuesMatch(expected, read(), tolerance)),
		timeoutMs,
	);
	try {
		const matched = await settled;
		assertNativeOperationCurrent(options);
		if (cancellation) throw cancellation;
		return { actual: read(), matched };
	} finally {
		for (const each of types) target.removeEventListener(each, onEvent);
		if (quietTimer !== null) clearTimeout(quietTimer);
		if (timeoutId !== null) clearTimeout(timeoutId);
		if (options.signal && abortListener) options.signal.removeEventListener('abort', abortListener);
	}
}

export async function measureVideoFrameDuration(
	video: HTMLVideoElement,
	sourceRevision: number,
	options: NativeMediaOperationOptions = {},
): Promise<number> {
	assertNativeOperationCurrent(options);
	const cached = videoCadence.get(video);
	if (cached?.sourceRevision === sourceRevision) return cached.frameDuration;
	if (video.paused || typeof video.requestVideoFrameCallback !== 'function') {
		throw new Error('Frame cadence is unavailable until this source has rendered measurable frames');
	}
	const frameDuration = await new Promise<number>((resolve, reject) => {
		let previousMediaTime: number | null = null;
		let callbackId: number | null = null;
		let samples = 0;
		let settled = false;
		const deltas: number[] = [];
		const timeoutId = setTimeout(() => finish(null, 'deadline'), options.timeoutMs ?? 750);
		const onAbort = (): void => finish(
			null,
			abortError(options.signal).code === 'stale-media-source' ? 'stale' : 'cancelled',
		);
		const finish = (
			duration: number | null,
			reason: 'cancelled' | 'stale' | 'deadline' | undefined = undefined,
		): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutId);
			options.signal?.removeEventListener('abort', onAbort);
			if (callbackId !== null && typeof video.cancelVideoFrameCallback === 'function') {
				video.cancelVideoFrameCallback(callbackId);
			}
			callbackId = null;
			if (duration === null) {
				if (reason === 'cancelled') {
					reject(new ContentLifecycleError('cancelled', 'Frame cadence measurement was cancelled'));
				} else if (reason === 'stale') {
					reject(new ContentLifecycleError('stale-media-source', 'Frame cadence source became stale'));
				} else if (reason === 'deadline') {
					reject(new ContentLifecycleError('deadline-exceeded', 'Frame cadence measurement timed out'));
				} else {
					reject(new Error('Frame cadence measurement timed out'));
				}
			} else resolve(duration);
		};
		const sample: VideoFrameRequestCallback = (_now, metadata) => {
			if (settled) return;
			if (options.signal?.aborted) {
				finish(null, 'cancelled');
				return;
			}
			if (options.isCurrent && !options.isCurrent()) {
				finish(null, 'stale');
				return;
			}
			callbackId = null;
			const mediaTime = metadata.mediaTime;
			if (previousMediaTime !== null) {
				const delta = mediaTime - previousMediaTime;
				if (Number.isFinite(delta) && delta >= 1 / 240 && delta <= 1 / 5) {
					deltas.push(delta);
				}
			}
			previousMediaTime = mediaTime;
			samples += 1;
			if (deltas.length >= 5 || samples >= 8) {
				if (deltas.length < 3) {
					finish(null);
					return;
				}
				const ordered = [...deltas].sort((left, right) => left - right);
				const median = ordered.at(Math.floor(ordered.length / 2));
				const first = ordered.at(0);
				const last = ordered.at(-1);
				if (median === undefined || first === undefined || last === undefined) {
					finish(null);
					return;
				}
				const stable = last - first <= median * 0.35;
				if (stable || samples >= 8) finish(median);
				else callbackId = video.requestVideoFrameCallback(sample);
				return;
			}
			callbackId = video.requestVideoFrameCallback(sample);
		};
		options.signal?.addEventListener('abort', onAbort, { once: true });
		callbackId = video.requestVideoFrameCallback(sample);
	});
	assertNativeOperationCurrent(options);
	videoCadence.set(video, { sourceRevision, frameDuration });
	return frameDuration;
}

export function clampNativeSeek(element: HTMLMediaElement, desired: number): number {
	const maximum = Number.isFinite(element.duration) ? element.duration : desired;
	const value = Math.max(0, Math.min(maximum, desired));
	if (element.seekable.length === 0) return value;
	for (let index = 0; index < element.seekable.length; index += 1) {
		const start = element.seekable.start(index);
		const end = element.seekable.end(index);
		if (value >= start && value <= end) return value;
		if (value < start) return start;
	}
	return element.seekable.end(element.seekable.length - 1);
}

export function writeNativeCurrentTime(element: HTMLMediaElement, currentTime: number): number {
	element.currentTime = currentTime;
	return element.currentTime;
}

export async function seekNativeMedia(
	element: HTMLMediaElement,
	desired: number,
	tolerance = 0.05,
	options: NativeMediaOperationOptions = {},
): Promise<number> {
	assertNativeOperationCurrent(options);
	const target = clampNativeSeek(element, desired);
	const owned = markOwnedSeek(element, target, tolerance);
	let acknowledged = false;
	try {
		assertNativeOperationCurrent(options);
		writeNativeCurrentTime(element, target);
		if (element.seeking || Math.abs(element.currentTime - target) > tolerance) {
			await waitForNativeEvent(
				element,
				'seeked',
				() => !element.seeking && Math.abs(element.currentTime - target) <= tolerance,
				options.timeoutMs ?? 750,
				options,
			);
		}
		assertNativeOperationCurrent(options);
		if (element.seeking || Math.abs(element.currentTime - target) > tolerance) {
			throw new Error('Seek readback did not reach the requested media time');
		}
		acknowledged = true;
		return element.currentTime;
	} finally {
		// A standards-compliant `seeked` event may be queued after the synchronous
		// getter already confirms the target. Keep the token until that event (or
		// its one-second expiry) so marker/A-B/frame-step ACKs do not become a
		// second page-originated snapshot revision.
		if (!acknowledged) releaseOwnedSeek(element, owned);
	}
}

function waitForNativeEvent(
	target: EventTarget,
	type: string,
	readback: () => boolean,
	timeoutMs: number,
	options: NativeMediaOperationOptions = {},
): Promise<void> {
	assertNativeOperationCurrent(options);
	if (readback()) return Promise.resolve();
	return new Promise((resolve, reject) => {
		let settled = false;
		let timeoutId: ReturnType<typeof setTimeout> | null = null;
		const finish = (): void => {
			if (settled) return;
			settled = true;
			target.removeEventListener(type, onEvent);
			if (timeoutId !== null) clearTimeout(timeoutId);
			options.signal?.removeEventListener('abort', onAbort);
			resolve();
		};
		const abort = (error: ContentLifecycleError): void => {
			if (settled) return;
			settled = true;
			target.removeEventListener(type, onEvent);
			if (timeoutId !== null) clearTimeout(timeoutId);
			options.signal?.removeEventListener('abort', onAbort);
			reject(error);
		};
		const onAbort = (): void => {
			const error = abortError(options.signal);
			abort(error);
		};
		const onEvent = (): void => {
			if (options.isCurrent && !options.isCurrent()) {
				abort(new ContentLifecycleError('stale-media-source', 'Native media source became stale'));
				return;
			}
			if (readback()) finish();
		};
		timeoutId = setTimeout(finish, timeoutMs);
		target.addEventListener(type, onEvent);
		options.signal?.addEventListener('abort', onAbort, { once: true });
	});
}
