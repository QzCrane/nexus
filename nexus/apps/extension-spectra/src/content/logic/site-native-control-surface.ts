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

const PLAYBACK_BUTTON_SELECTOR = [
	'[class*="player-pause"]',
	'[class*="player-play"]',
	'[title*="暂停"]',
	'[title*="播放"]',
	'[title*="开始观看"]',
	'[aria-label*="Pause"]',
	'[aria-label*="Play"]',
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
			|| hasControl(node, PLAYBACK_BUTTON_SELECTOR)) return node;
	}
	if (typeof document === 'undefined') return null;
	const media = queryAll(document, 'video,audio');
	return media.length === 1 && media[0] === element ? document : null;
}

function findVolumeTrack(element: Element): HTMLElement | null {
	for (const candidate of queryAll(controlScope(element), VOLUME_TRACK_SELECTOR)) {
		if (!isUsableControl(candidate)) continue;
		const name = `${candidate.className} ${candidate.getAttribute?.('aria-label') ?? ''}`;
		if (!/sound-progress|volume|音量/iu.test(name)) continue;
		const rect = candidate.getBoundingClientRect();
		// A volume track has a filled bar / handle and a real horizontal extent.
		if (rect.width >= 24 && rect.height > 0 && (candidate.childElementCount ?? 0) > 0) return candidate;
	}
	return null;
}

function findPlaybackButton(element: Element): HTMLElement | null {
	for (const candidate of queryAll(controlScope(element), PLAYBACK_BUTTON_SELECTOR)) {
		if (!isUsableControl(candidate)) continue;
		const className = typeof candidate.className === 'string' ? candidate.className : '';
		const title = typeof candidate.getAttribute === 'function'
			? candidate.getAttribute('title') ?? '' : '';
		if (/refresh|reload|fullscreen|刷新|全屏/i.test(`${className} ${title}`)) continue;
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
	const x = rect.left + rect.width * Math.max(0, Math.min(1, ratio));
	const y = rect.top + rect.height / 2;
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
	const filled = queryAll(control, '[class*="bar"]')[0];
	const width = filled && isUsableControl(filled) ? filled.getBoundingClientRect().width : 0;
	if (rect.width > 0 && filled && isUsableControl(filled)) return Math.max(0, Math.min(1, width / rect.width));
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
 * the ordinary playback ACK succeeds. Returns false when no such button exists.
 */
export function projectSiteNativePlayback(element: HTMLMediaElement, playing: boolean): boolean {
	if (typeof MouseEvent !== 'function') return false;
	const control = findPlaybackButton(element);
	if (!control) return false;
	if (!element.paused === playing) return true;
	control.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: eventView() }));
	return true;
}
