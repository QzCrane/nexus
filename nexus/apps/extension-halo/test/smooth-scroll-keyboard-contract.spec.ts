import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function source(relativeUrl: string): string {
	return readFileSync(fileURLToPath(new URL(relativeUrl, import.meta.url)), 'utf8');
}

const keyboardSource = source('../src/content/smooth-scroll-keyboard.ts');
const hostSource = source('../src/content/smooth-scroll.ts');

describe('smooth-scroll keyboard architecture contract', () => {
	test('never infers shortcut ownership from video layout or page identity', () => {
		expect(keyboardSource).not.toContain('getBoundingClientRect');
		expect(keyboardSource).not.toContain('clientWidth');
		expect(keyboardSource).not.toContain('clientHeight');
		expect(keyboardSource).not.toContain('VIDEO_VIEWPORT_RATIO');
		expect(keyboardSource).not.toContain("getElementsByTagName('video')");
		expect(keyboardSource).toContain(
			"document.querySelectorAll<HTMLMediaElement>('video, audio')",
		);
		expect(keyboardSource).toContain('mediaStateChanged');
	});

	test('does not suppress page handlers or reuse wheel acceleration state', () => {
		expect(keyboardSource).not.toContain('stopPropagation(');
		expect(keyboardSource).not.toContain('stopImmediatePropagation(');
		expect(keyboardSource).not.toContain('updateAcceleration(');
		expect(keyboardSource).not.toContain('accelerationTarget');
		expect(keyboardSource).not.toContain('accelerationDirection');
		expect(keyboardSource).toContain('ARROW_REPEAT_INTERVAL_MS');
		expect(keyboardSource).toContain('KEYBOARD_ACCELERATION_STEP_MS');
	});

	test('finalizes after page handlers, including document propagation stops', () => {
		expect(keyboardSource).toContain(
			"document.addEventListener('keydown', finalizeAtDocument)",
		);
		expect(keyboardSource).toContain(
			"window.addEventListener('keydown', finalizeAtWindow)",
		);
		expect(keyboardSource).toContain('candidate.cancelBubble');
	});

	test('registers pre-site capture synchronously at document start', () => {
		const attachIndex = hostSource.indexOf(
			'if (settings.enabled) attachListeners();',
		);
		const storageAwaitIndex = hostSource.indexOf(
			'await chrome.storage.sync.get([STORAGE_KEY])',
		);

		expect(attachIndex).toBeGreaterThanOrEqual(0);
		expect(storageAwaitIndex).toBeGreaterThan(attachIndex);
		expect(hostSource).toContain(
			"window.addEventListener('keydown', onKeydownCapture, true)",
		);
		expect(hostSource).toContain(
			"window.addEventListener('blur', resetDocumentRuntime)",
		);
		expect(hostSource).not.toContain("addEventListener('DOMContentLoaded'");
	});
});
