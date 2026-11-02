import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { injectFrameHeightKey } from '../scripts/frame-reserve-key';
import { releasePopupFrame, resolveFrameTarget, trackPopupFrame } from '../src/popup/frame-height';
import {
	ACTION_POPUP_PATH,
	FRAME_HEIGHT_KEY_PLACEHOLDER,
	FRAME_PLAN_PARAM,
	POPUP_BOOTSTRAP,
	actionPopupPath,
} from '../src/shared/popup-bootstrap';

// Root geometry follows committed content. A shorter open never inherits an
// earlier height, and pending actual reads do not participate in sizing.
describe('popup frame target', () => {
	test('defers observer writes and retires queued geometry work on release or retrack', () => {
		const keys = ['window', 'document', 'ResizeObserver', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame'] as const;
		const originals = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
		let contentHeight = 352;
		const html = { dataset: { spectraStructureReady: 'true' }, style: { height: '600px', overflowY: 'hidden' }, classList: { add() {}, remove() {} } };
		const container = { getBoundingClientRect: () => ({ height: contentHeight }) };
		const callbacks = new Map<number, FrameRequestCallback>();
		let nextFrame = 0;
		const resizeCallbacks: Array<() => void> = [];
		const mutations: Array<() => void> = [];
		const globals = {
			window: { location: { search: '?cards=1' }, localStorage: {
				getItem() { throw new Error('Live geometry must not read historical hints'); },
				setItem() { throw new Error('Live geometry must not persist height'); },
			} },
			document: { documentElement: html, querySelector: () => container },
			ResizeObserver: class { constructor(callback: () => void) { resizeCallbacks.push(callback); } observe() {} disconnect() {} },
			MutationObserver: class { constructor(callback: () => void) { mutations.push(callback); } observe() {} disconnect() {} },
			requestAnimationFrame: (callback: FrameRequestCallback) => { callbacks.set(++nextFrame, callback); return nextFrame; },
			cancelAnimationFrame: (handle: number) => { callbacks.delete(handle); },
		};
		const drain = () => {
			for (const [handle, callback] of [...callbacks]) {
				callbacks.delete(handle);
				callback(0);
			}
		};
		try {
			for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, value: globals[key] });
			releasePopupFrame();
			trackPopupFrame();
			expect(html.style.height).toBe('352px');
			drain();
			contentHeight = 720;
			resizeCallbacks[0]?.();
			mutations[0]?.();
			resizeCallbacks[0]?.();
			expect(html.style.height).toBe('352px');
			expect(callbacks.size).toBe(1);
			drain();
			expect(html.style.height).toBe('600px');
			expect(html.style.overflowY).toBe('auto');
			contentHeight = 410;
			resizeCallbacks[0]?.();
			const retired = [...callbacks.values()];
			releasePopupFrame();
			expect(callbacks.size).toBe(0);
			for (const callback of retired) callback(0);
			expect(html.style.height).toBe('');
			trackPopupFrame();
			expect(html.style.height).toBe('410px');
			drain();
			contentHeight = 720;
			resizeCallbacks[0]?.();
			expect(callbacks.size).toBe(0);
			expect(html.style.height).toBe('410px');
		} finally {
			releasePopupFrame();
			for (const key of keys) {
				const original = originals.get(key);
				if (original) Object.defineProperty(globalThis, key, original);
				else Reflect.deleteProperty(globalThis, key);
			}
		}
	});

	test('uses committed intrinsic content without waiting for actual hydration', () => {
		expect(resolveFrameTarget(352)).toBe(352);
		expect(resolveFrameTarget(280)).toBe(280);
	});

	test('never past the height Chrome grants the Action Popup', () => {
		expect(resolveFrameTarget(675.38)).toBe(600);
		expect(resolveFrameTarget(0)).toBe(0);
	});
});

// The announcement carries structure, never a historical height lookup.
describe('popup frame plan', () => {
	test('announces the count the Popup will draw', () => {
		expect(actionPopupPath(0)).toBe(`${ACTION_POPUP_PATH}?${FRAME_PLAN_PARAM}=0`);
		expect(actionPopupPath(3)).toBe(`${ACTION_POPUP_PATH}?${FRAME_PLAN_PARAM}=3`);
	});

	test('opens the bare document when the count cannot be decided', () => {
		// No count means no announced slots, never a guess from an older open.
		expect(actionPopupPath(null)).toBe(ACTION_POPUP_PATH);
		expect(actionPopupPath(-1)).toBe(ACTION_POPUP_PATH);
		expect(actionPopupPath(Number.NaN)).toBe(ACTION_POPUP_PATH);
	});
});

describe('popup bootstrap injection', () => {
	const headScript = readFileSync(
		resolve(import.meta.dir, '../public/frame-reserve.js'),
		'utf8',
	);

	test('the head script carries a placeholder, not keys of its own', () => {
		expect(headScript).toContain(FRAME_HEIGHT_KEY_PLACEHOLDER);
		// With the placeholder taken out, no key may remain. Literal ones would be a
		// second definition of the same strings, and nothing would keep the two in
		// step once either changed.
		expect(headScript.replaceAll(FRAME_HEIGHT_KEY_PLACEHOLDER, ''))
			.not.toContain('spectra.popup.frameHeight');
		expect(headScript.replaceAll(FRAME_HEIGHT_KEY_PLACEHOLDER, ''))
			.not.toContain(POPUP_BOOTSTRAP.themeKey);
	});

	test('the build injects the canonical theme and surface contract', () => {
		const built = injectFrameHeightKey(headScript);
		expect(built).not.toContain(FRAME_HEIGHT_KEY_PLACEHOLDER);
		const injected = JSON.parse(
			built.slice(built.indexOf("JSON.parse('") + "JSON.parse('".length, built.indexOf("')")),
		) as typeof POPUP_BOOTSTRAP;
		expect(injected).toEqual({ ...POPUP_BOOTSTRAP });
	});

	test('a head script without the placeholder fails the build', () => {
		// The silent failure this prevents: a head script that reads its own keys
		// would reserve a height the Popup module never persists, and every open
		// would jump again with nothing to point at the cause.
		expect(() => injectFrameHeightKey('const key = "spectra.popup.frameHeight";')).toThrow();
	});
});
