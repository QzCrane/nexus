// goal: drive the site's own native controls when the site owns the audible signal
// A missing control permits DOM routing; a discovered control must prove its readback.

import { assertNativeOperationCurrent, type NativeMediaOperationOptions } from './native-media-async';

const VOLUME_TRACK_SELECTOR = [
	'[class*="sound-progress"]',
	'[class*="volume-progress"]',
	'[class*="volume-track"]',
	'[class*="volume-slider"]',
	'[role="slider"]',
].join(',');

const PLAY_BUTTON_SELECTOR = [
	'[class*="player-play"]',
	'[class*="btn-play"]',
	'[class*="play-btn"]',
	'[title*="播放"]',
	'[title*="开始观看"]',
	'[aria-label*="Play"]',
	'[aria-label*="播放"]',
].join(',');

const PAUSE_BUTTON_SELECTOR = [
	'[class*="player-pause"]',
	'[class*="btn-pause"]',
	'[class*="pause-btn"]',
	'[title*="暂停"]',
	'[aria-label*="Pause"]',
	'[aria-label*="暂停"]',
].join(',');

const PLAYBACK_BUTTON_FALLBACK_SELECTOR = [
	'#player-btn',
	'[class*="player-btn"]',
	'[class*="play-pause"]',
	'[class*="pause-play"]',
	'[role="button"][class*="play"]',
	'[role="button"][class*="pause"]',
].join(',');

// A unit harness may install only the media globals. Discovery must then be a
// no-op rather than an exception: the standard-DOM writer is still authoritative.
function queryAll(root: ParentNode | null, selector: string): Element[] {
	if (!root || typeof root.querySelectorAll !== 'function') return [];
	try { return [...root.querySelectorAll(selector)]; }
	catch { return []; }
}

function hasControl(root: ParentNode, selector: string): boolean {
	if (typeof root.querySelector !== 'function') return false;
	try { return root.querySelector(selector) !== null; }
	catch { return false; }
}

function isUsableControl(node: Element): node is HTMLElement {
	const candidate = node as HTMLElement;
	return typeof candidate.getBoundingClientRect === 'function'
		&& typeof candidate.dispatchEvent === 'function';
}

/** The nearest ancestor that actually owns the player's own controls. */
function controlScope(element: Element): ParentNode | null {
	let node: Element | null = element.parentElement ?? null;
	for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement ?? null) {
		if (hasControl(node, VOLUME_TRACK_SELECTOR)
			|| hasControl(node, PLAY_BUTTON_SELECTOR)
			|| hasControl(node, PAUSE_BUTTON_SELECTOR)
			|| hasControl(node, PLAYBACK_BUTTON_FALLBACK_SELECTOR)) return node;
	}
	if (typeof document === 'undefined') return null;
	const media = queryAll(document, 'video,audio');
	return media.length === 1 && media[0] === element ? document : null;
}

function wakeControlScope(element: Element): void {
	if (typeof MouseEvent !== 'function') return;
	const scope = controlScope(element);
	if (!scope || typeof (scope as Element).dispatchEvent !== 'function') return;
	const candidate = scope as Element;
	const rect = typeof candidate.getBoundingClientRect === 'function'
		? candidate.getBoundingClientRect()
		: { left: 0, top: 0, width: 0, height: 0 };
	const base = {
		bubbles: true,
		cancelable: true,
		view: eventView(),
		clientX: rect.left + rect.width / 2,
		clientY: rect.top + rect.height / 2,
	};
	for (const type of ['pointerenter', 'mousemove']) {
		candidate.dispatchEvent(new MouseEvent(type, base));
	}
}

function findVolumeTrack(element: Element): HTMLElement | null {
	for (const candidate of queryAll(controlScope(element), VOLUME_TRACK_SELECTOR)) {
		if (!isUsableControl(candidate)) continue;
		const name = `${candidate.className} ${candidate.getAttribute?.('aria-label') ?? ''}`;
		if (!/sound-progress|volume|音量/iu.test(name)) continue;
		const rect = candidate.getBoundingClientRect();
		// A volume track has a filled bar / handle and a real horizontal or vertical extent.
		const isHorizontal = rect.width >= 24 && rect.height > 0;
		const isVertical = rect.height >= 24 && rect.width > 0;
		if ((isHorizontal || isVertical) && (candidate.childElementCount ?? 0) > 0) return candidate;
	}
	return null;
}

function findPlaybackButton(element: Element, playing: boolean): HTMLElement | null {
	const scope = controlScope(element);
	const primarySelector = playing ? PLAY_BUTTON_SELECTOR : PAUSE_BUTTON_SELECTOR;
	const candidates = [
		...queryAll(scope, primarySelector),
		...queryAll(scope, PLAYBACK_BUTTON_FALLBACK_SELECTOR),
	];
	for (const candidate of candidates) {
		if (!isUsableControl(candidate)) continue;
		if (candidate === element || (typeof candidate.contains === 'function' && candidate.contains(element))) continue;
		const rect = candidate.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) continue;
		const className = typeof candidate.className === 'string' ? candidate.className : '';
		const title = typeof candidate.getAttribute === 'function'
			? candidate.getAttribute('title') ?? '' : '';
		const aria = typeof candidate.getAttribute === 'function'
			? candidate.getAttribute('aria-label') ?? '' : '';
		const label = `${className} ${title} ${aria}`;
		if (/refresh|reload|fullscreen|rotate|tooltips|tooltip|刷新|全屏|旋转/i.test(label)) continue;
		if (playing && /pause|暂停/i.test(label) && !/play|播放/i.test(label)) continue;
		if (!playing && /play|播放/i.test(label) && !/pause|暂停/i.test(label)) continue;
		return candidate;
	}
	return null;
}

// `window` is optional in a content-script unit harness; `MouseEventInit.view`
// is optional in the DOM too, so omit it rather than dereferencing the global.
function eventView(): Window | null | undefined {
	return typeof window === 'undefined' ? undefined : window;
}

function dispatchTrackInput(control: HTMLElement, ratio: number): void {
	if (typeof MouseEvent !== 'function') return;
	const rect = control.getBoundingClientRect();
	const isVertical = rect.height > rect.width * 1.5;
	const clampedRatio = Math.max(0, Math.min(1, ratio));
	const x = isVertical ? rect.left + rect.width / 2 : rect.left + rect.width * clampedRatio;
	const y = isVertical ? rect.bottom - rect.height * clampedRatio : rect.top + rect.height / 2;
	const base = { bubbles: true, cancelable: true, view: eventView(), clientX: x, clientY: y };
	for (const type of ['pointerdown', 'mousedown']) {
		control.dispatchEvent(new MouseEvent(type, { ...base, buttons: 1 }));
	}
	control.dispatchEvent(new MouseEvent('pointermove', { ...base, buttons: 1 }));
	if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function') {
		document.dispatchEvent(new MouseEvent('mousemove', { ...base, buttons: 1 }));
	}
	for (const type of ['pointerup', 'mouseup', 'click']) {
		control.dispatchEvent(new MouseEvent(type, { ...base, buttons: 0 }));
	}
}

function wait(ms: number): Promise<void> {
	return new Promise(resolve => { setTimeout(resolve, ms); });
}

/**
 * The site's filled bar is its own state. `element.volume` is only a mirror and
 * a paused player may leave that mirror behind while the UI (and the player's
 * own gain) already moved, so calibrating on the DOM property alone would keep
 * clicking until the slider hit its end.
 */
function readSiteLevel(control: HTMLElement, element: HTMLMediaElement): number {
	const rect = control.getBoundingClientRect();
	const isVertical = rect.height > rect.width * 1.5;
	const filled = queryAll(control, '[class*="bar"]')[0];
	let ratio = 0;
	if (isVertical) {
		const height = filled && isUsableControl(filled) ? filled.getBoundingClientRect().height : 0;
		if (rect.height > 0 && filled && isUsableControl(filled)) {
			ratio = Math.max(0, Math.min(1, height / rect.height));
		}
	} else {
		const width = filled && isUsableControl(filled) ? filled.getBoundingClientRect().width : 0;
		if (rect.width > 0 && filled && isUsableControl(filled)) {
			ratio = Math.max(0, Math.min(1, width / rect.width));
		}
	}
	if (ratio <= 0.005 && element.volume > 0.05 && !element.muted) {
		const isCollapsed = !filled
			|| (isVertical ? rect.height <= 0 : rect.width <= 0)
			|| ('offsetParent' in control && (control as HTMLElement).offsetParent === null);
		if (isCollapsed) return element.volume;
	}
	if ((isVertical ? rect.height > 0 : rect.width > 0) && filled && isUsableControl(filled)) {
		return ratio;
	}
	return element.volume;
}

/**
 * Passive witness for a page whose own slider owns the audible level. The
 * processor stays at unity there, so the runtime's applied value is a gain
 * input, not the number the viewer sees; the site's filled bar is the value
 * that every read, snapshot and badge must report.
 */
export function readSiteNativeVolumeLevel(element: HTMLMediaElement): number | null {
	const control = findVolumeTrack(element);
	if (!control) return null;
	return Math.round(readSiteLevel(control, element) * 100);
}

/**
 * Set the page's own volume slider instead of writing `element.volume`.
 *
 * On document-output pages the element's volume is only a mirror: the player
 * keeps its own audible gain and its own UI state. Writing the DOM property
 * leaves both of them behind (verified on Huya: `volume = 0.8` did not move the
 * site's bar). A synthetic input on the site's own track goes through the
 * player's real handler, which updates its gain, its bar and the element at
 * once — and the resulting `volumechange` is the existing passive observation
 * that keeps the extension in sync.
 *
 * The player animates its volume in small steps and offsets the click by the
 * handle radius, so three bounded calibration passes converge on the requested
 * value. A discovered control that cannot reach the value fails readback;
 * a DOM-only write cannot prove that the site's audible gain changed.
 */
export async function projectSiteNativeVolume(
	element: HTMLMediaElement,
	requested: number,
	options: NativeMediaOperationOptions = {},
): Promise<number | null> {
	wakeControlScope(element);
	const control = findVolumeTrack(element);
	if (!control || typeof MouseEvent !== 'function') return null;
	const target = Math.max(0, Math.min(100, requested)) / 100;
	let ratio = target;
	let level = readSiteLevel(control, element);
	for (let attempt = 0; attempt < 3; attempt += 1) {
		assertNativeOperationCurrent(options);
		if (Math.abs(level - target) <= 0.02) break;
		dispatchTrackInput(control, ratio);
		await wait(220);
		assertNativeOperationCurrent(options);
		level = readSiteLevel(control, element);
		ratio = Math.max(0, Math.min(1, ratio + (target - level)));
	}
	if (Math.abs(level - target) > 0.06) throw new Error('Site volume readback did not acknowledge the requested value');
	// This module never writes `element.volume`: SCTRL-003 keeps a single
	// canonical media writer (native-media-executor.ts). The caller aligns the
	// DOM mirror when the site's own handler has not already done so, and the
	// resulting `volumechange` remains the existing passive observation.
	return Math.round(level * 100);
}

/**
 * Use the site's own play/pause button when it has one.
 *
 * A live player can veto a raw `element.pause()`: Huya's `vplayer.js` calls
 * `play()` again ~10ms later because its own state still says "watching", and
 * the stable readback then reports a mismatch on every single press. Clicking
 * the native button updates the player's state first, so the pause sticks and
 * the ordinary playback ACK succeeds.
 *
 * This implementation is strictly event-driven: it never polls with busy loops.
 * It listens for the native 'play'/'pause' event on the media element, dispatches
 * the gesture, and resolves immediately when the native event fires or if the
 * state settles synchronously.
 */
export function projectSiteNativePlayback(
	element: HTMLMediaElement,
	playing: boolean,
	options: NativeMediaOperationOptions = {},
): boolean | Promise<boolean> {
	if (typeof MouseEvent !== 'function') return false;
	assertNativeOperationCurrent(options);
	if (!element.paused === playing) return true;

	wakeControlScope(element);
	const control = findPlaybackButton(element, playing);
	if (!control) return false;

	const targetEvent = playing ? 'play' : 'pause';

	return new Promise<boolean>((resolve) => {
		let settled = false;
		let timeoutId: ReturnType<typeof setTimeout> | null = null;

		const cleanup = (): void => {
			if (settled) return;
			settled = true;
			if (timeoutId !== null) clearTimeout(timeoutId);
			element.removeEventListener(targetEvent, onNativeStateAchieved);
			options.signal?.removeEventListener('abort', onAbort);
		};

		const onNativeStateAchieved = (): void => {
			cleanup();
			resolve(true);
		};

		const onAbort = (): void => {
			cleanup();
			resolve(!element.paused === playing);
		};

		element.addEventListener(targetEvent, onNativeStateAchieved, { once: true });
		options.signal?.addEventListener('abort', onAbort, { once: true });

		timeoutId = setTimeout(() => {
			cleanup();
			resolve(!element.paused === playing);
		}, 200);

		const rect = control.getBoundingClientRect();
		const base = {
			bubbles: true,
			cancelable: true,
			view: eventView(),
			clientX: rect.left + rect.width / 2,
			clientY: rect.top + rect.height / 2,
		};
		for (const type of ['pointerdown', 'mousedown']) {
			control.dispatchEvent(new MouseEvent(type, { ...base, buttons: 1 }));
		}
		for (const type of ['pointerup', 'mouseup', 'click']) {
			control.dispatchEvent(new MouseEvent(type, { ...base, buttons: 0 }));
		}

		if (!element.paused === playing) {
			cleanup();
			resolve(true);
		}
	});
}
