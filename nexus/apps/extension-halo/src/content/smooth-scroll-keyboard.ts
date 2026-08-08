import { prefersReducedMotion, resolveMainScrollRoute, resolveScrollRoute, shouldIgnoreInput } from '../tools/smooth-scroll/utils';
import { clearQueue, scrollTo } from '../tools/smooth-scroll/engine';
import {
	resetWheelRuntimeState,
	settings,
} from './smooth-scroll-state';

// goal: Give page handlers first refusal, then animate only unclaimed
// page-scroll intent.
//
// A permanent window-bubble listener cannot remain last: an SPA can register
// another listener after HALO. The permanent capture listener below therefore
// appends per-event finalizers after all handlers that already exist. Ordinary
// propagation finishes at window; a document fallback handles a site that
// deliberately stops propagation before the event reaches window.
const KEYS: Record<string, number> = {
	'ArrowDown': 1, 'ArrowUp': -1,
	'PageDown': 0, 'PageUp': 0,
	' ': 0,
};

// Keyboard repeat frequency is an OS preference, not user scroll intent.
// The first repeat preserves the operating system's initial hold delay; later
// repeats advance on one canonical clock, compensating both dense and sparse
// repeat delivery without manufacturing input before the OS declares a hold.
const ARROW_REPEAT_INTERVAL_MS = 80;
const PAGE_REPEAT_MIN_INTERVAL_MS = 180;
const PAGE_REPEAT_MAX_INTERVAL_MS = 320;
const KEYBOARD_ACCELERATION_STEP_MS = 160;
const KEYBOARD_ACCELERATION_STEP = 0.5;

interface MediaState {
	muted: boolean;
	paused: boolean;
	playbackRate: number;
	volume: number;
}

interface MediaStateSnapshot extends MediaState {
	element: HTMLMediaElement;
}

export interface KeyboardCapture {
	mediaStates: MediaStateSnapshot[];
}

interface KeyboardStream {
	direction: number;
	key: string;
	lastAcceptedAt: number;
	repeatStartedAt: number | null;
	target: Element | Window;
}

let keyboardStream: KeyboardStream | null = null;

function isMediaShortcutKey(key: string): boolean {
	return key === ' ' || key === 'ArrowDown' || key === 'ArrowUp';
}

function readMediaState(element: HTMLMediaElement): MediaState | null {
	try {
		return {
			muted: element.muted,
			paused: element.paused,
			playbackRate: element.playbackRate,
			volume: element.volume,
		};
	} catch {
		// Unreadable wrappers are handled as absent evidence rather than turning a
		// keyboard event into either extension or website ownership by exception.
		return null;
	}
}

function captureMediaStates(key: string): MediaStateSnapshot[] {
	if (!isMediaShortcutKey(key) || typeof document === 'undefined') return [];
	const states: MediaStateSnapshot[] = [];
	for (const element of document.querySelectorAll<HTMLMediaElement>('video, audio')) {
		const state = readMediaState(element);
		if (state) states.push({ element, ...state });
	}
	return states;
}

function mediaStateChanged(states: readonly MediaStateSnapshot[]): boolean {
	for (const before of states) {
		const element = before.element;
		if (!element.isConnected) return true;
		const after = readMediaState(element);
		if (!after) continue;
		if (
			after.muted !== before.muted ||
			after.paused !== before.paused ||
			after.playbackRate !== before.playbackRate ||
			Math.abs(after.volume - before.volume) > Number.EPSILON
		) {
			return true;
		}
	}
	return false;
}

export function captureKeyboardState(e: KeyboardEvent): KeyboardCapture {
	return { mediaStates: captureMediaStates(e.key) };
}

function pageRepeatInterval(): number {
	return Math.min(
		PAGE_REPEAT_MAX_INTERVAL_MS,
		Math.max(PAGE_REPEAT_MIN_INTERVAL_MS, settings.animationTime * 0.6),
	);
}

function resetKeyboardStream(): void {
	keyboardStream = null;
}

function yieldKeyboard(e: KeyboardEvent, siteChangedMedia = false): void {
	// Some players mutate media state without preventDefault. The site action has
	// already happened in bubble phase, so cancel only the browser's native page
	// movement and leave propagation untouched.
	if (siteChangedMedia && !e.defaultPrevented) e.preventDefault();
	if (keyboardStream || !e.repeat) {
		clearQueue();
		resetKeyboardStream();
		resetWheelRuntimeState();
	}
}

function repeatResponse(timestamp: number): number {
	const repeatStartedAt = keyboardStream?.repeatStartedAt;
	if (repeatStartedAt === null || repeatStartedAt === undefined) return 1;
	const heldFor = Math.max(0, timestamp - repeatStartedAt);
	return Math.min(
		settings.accelerationMax,
		1 + Math.floor(heldFor / KEYBOARD_ACCELERATION_STEP_MS) *
			KEYBOARD_ACCELERATION_STEP,
	);
}

function admitRepeat(
	e: KeyboardEvent,
	timestamp: number,
	interval: number,
): number {
	if (!e.repeat || !keyboardStream) return 1;
	if (keyboardStream.repeatStartedAt === null) {
		keyboardStream.repeatStartedAt = timestamp;
		keyboardStream.lastAcceptedAt = timestamp;
		return 1;
	}

	const elapsed = timestamp - keyboardStream.lastAcceptedAt;
	if (elapsed < interval) {
		e.preventDefault();
		return 0;
	}
	const canonicalSteps = Math.floor(elapsed / interval);
	keyboardStream.lastAcceptedAt += canonicalSteps * interval;
	return canonicalSteps;
}

function shouldAlwaysYield(): boolean {
	return (
		!settings.enabled ||
		!settings.keyboard ||
		shouldIgnoreInput(document.activeElement) ||
		document.fullscreenElement !== null ||
		(settings.respectReducedMotion && prefersReducedMotion())
	);
}

// Capture-phase entrypoint. Ownership is intentionally not decided here.
export function onKeydownCapture(e: KeyboardEvent): void {
	if (!e.isTrusted || KEYS[e.key] === undefined) return;
	if (
		e.ctrlKey ||
		e.altKey ||
		e.metaKey ||
		shouldAlwaysYield()
	) {
		yieldKeyboard(e);
		return;
	}

	const capture = captureKeyboardState(e);
	let finalized = false;

	function cleanup(): void {
		document.removeEventListener('keydown', finalizeAtDocument);
		window.removeEventListener('keydown', finalizeAtWindow);
	}

	function finalize(candidate: KeyboardEvent): void {
		if (finalized || candidate !== e) return;
		finalized = true;
		cleanup();
		onKeydown(candidate, capture);
	}

	function finalizeAtDocument(candidate: KeyboardEvent): void {
		// stopPropagation still permits later listeners on the same target. If a
		// site intentionally prevents the event from reaching window, document is
		// the last safe point where HALO can observe that same-event claim.
		if (candidate === e && candidate.cancelBubble) finalize(candidate);
	}

	function finalizeAtWindow(candidate: KeyboardEvent): void {
		finalize(candidate);
	}

	document.addEventListener('keydown', finalizeAtDocument);
	window.addEventListener('keydown', finalizeAtWindow);
	setTimeout(() => {
		if (!finalized) cleanup();
	}, 0);
}

export function onKeyup(e: KeyboardEvent): void {
	if (!e.isTrusted || KEYS[e.key] === undefined) return;
	if (keyboardStream?.key === e.key) resetKeyboardStream();
}

// Bubble finalizer. Exported with an explicit capture seam for deterministic
// unit tests; production always supplies the capture taken before page handlers.
export function onKeydown(
	e: KeyboardEvent,
	capture: KeyboardCapture = captureKeyboardState(e),
): void {
	if (!e.isTrusted) return;
	const keyFactor = KEYS[e.key];
	if (keyFactor === undefined) return;

	const siteChangedMedia = mediaStateChanged(capture.mediaStates);
	if (
		e.defaultPrevented ||
		e.cancelBubble ||
		siteChangedMedia ||
		e.ctrlKey ||
		e.altKey ||
		e.metaKey ||
		shouldAlwaysYield()
	) {
		yieldKeyboard(e, siteChangedMedia);
		return;
	}

	const active = document.activeElement;
	const isGeneric = !active || active === document.body || active === document.documentElement;
	const page = window.innerHeight * 0.9;
	let dy = 0;

	if (e.key === 'PageDown') dy = page;
	else if (e.key === 'PageUp') dy = -page;
	else if (e.key === ' ') dy = e.shiftKey ? -page : page;
	else dy = keyFactor * settings.arrowKeyStep;

	const direction = Math.sign(dy);
	const timestamp = performance.now();
	const isDiscreteJump = e.key === ' ' || e.key === 'PageDown' || e.key === 'PageUp';
	const route = isGeneric
		? resolveMainScrollRoute(dy)
		: resolveScrollRoute(active, dy);
	if (route.kind === 'blocked') {
		e.preventDefault();
		yieldKeyboard(e);
		return;
	}
	if (route.kind !== 'animate') {
		yieldKeyboard(e);
		return;
	}

	const sameStream =
		e.repeat &&
		keyboardStream !== null &&
		keyboardStream.key === e.key &&
		keyboardStream.target === route.target &&
		keyboardStream.direction === direction;
	let admittedSteps = 1;

	if (!sameStream) {
		// A fresh keyboard command owns a new physical stream. Clear wheel or
		// prior-key backlog so its first response is deterministic; repeats are
		// the only events allowed to accumulate into this keyboard stream.
		clearQueue();
		keyboardStream = {
			direction,
			key: e.key,
			lastAcceptedAt: timestamp,
			repeatStartedAt: e.repeat ? timestamp : null,
			target: route.target,
		};
		resetWheelRuntimeState();
	} else {
		const canonicalSteps = admitRepeat(
			e,
			timestamp,
			isDiscreteJump ? pageRepeatInterval() : ARROW_REPEAT_INTERVAL_MS,
		);
		if (!canonicalSteps) return;
		// Page-sized keys remain one discrete command per admitted browser event;
		// arrow holds compensate sparse delivery to preserve their physical rate.
		admittedSteps = isDiscreteJump ? 1 : canonicalSteps;
	}

	const responseMultiplier = isDiscreteJump || !e.repeat
		? 1
		: repeatResponse(timestamp);
	const accepted = scrollTo(
		route.target,
		0,
		dy * admittedSteps,
		route.admission,
		'coarse',
		timestamp,
		responseMultiplier,
	);
	if (!accepted) {
		yieldKeyboard(e);
		return;
	}
	e.preventDefault();
}

// Called by resetInputHandlers() for page lifecycle and settings transitions.
export function resetKeyboardRuntime(): void {
	resetKeyboardStream();
}
