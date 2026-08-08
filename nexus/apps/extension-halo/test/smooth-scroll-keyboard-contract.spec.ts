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

	test('finalizes after page handlers and honors same-event propagation claims', () => {
		expect(keyboardSource).toContain(
			"document.addEventListener('keydown', finalizeAtDocument)",
		);
		expect(keyboardSource).toContain(
			"window.addEventListener('keydown', finalizeAtWindow)",
		);
		expect(keyboardSource).toContain('candidate.cancelBubble');
		expect(keyboardSource).toMatch(/e\.defaultPrevented \|\|\s*e\.cancelBubble \|\|/u);
		expect(keyboardSource).toMatch(/setTimeout\(\(\) => \{\s*if \(!finalized\) cleanup\(\);\s*\}, 0\);/u);
		expect(keyboardSource).not.toMatch(/queueMicrotask\(\(\) => \{\s*if \(!finalized\) cleanup\(\);/u);
	});

	test('observes at document start and requires both settings plus module hydration before activation', () => {
		const observationIndex = hostSource.indexOf('attachObservationListeners();');
		const hydrationIndex = hostSource.indexOf('await Promise.allSettled([');
		const reconcileIndex = hostSource.lastIndexOf('reconcileInputOwnership();');

		expect(observationIndex).toBeGreaterThanOrEqual(0);
		expect(hydrationIndex).toBeGreaterThan(observationIndex);
		expect(reconcileIndex).toBeGreaterThan(hydrationIndex);
		expect(hostSource).toContain(
			"window.addEventListener('keydown', onObservedKeydown, true)",
		);
		expect(hostSource).toContain(
			'settingsHydrated && moduleHydrated && moduleEnabled && settings.enabled',
		);
		expect(hostSource).toContain('readOptionalPackagedModuleEnabled(MODULE_ID)');
		expect(hostSource).toContain('settingsRevisionBeforeHydration');
		expect(hostSource).toContain('moduleRevisionBeforeHydration');
		expect(hostSource).toContain(
			"window.addEventListener('blur', resetDocumentRuntime)",
		);
		expect(hostSource).not.toContain("addEventListener('DOMContentLoaded'");
	});

	test('keeps an uninstalled module inert without changing website-first listener order on reinstall', () => {
		expect(hostSource).toContain('if (!runtimeEnabled()) return;');
		expect(hostSource).toContain('if (runtimeEnabled()) attachActiveInputListeners();');
		expect(hostSource).toContain('else detachActiveInputListeners();');
		expect(hostSource).toContain('readOptionalPackagedModuleChangeEnabled');
	});
});
