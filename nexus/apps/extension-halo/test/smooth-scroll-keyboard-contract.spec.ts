import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function source(relativeUrl: string): string {
	return readFileSync(fileURLToPath(new URL(relativeUrl, import.meta.url)), 'utf8');
}

const keyboardSource = source('../src/content/smooth-scroll-keyboard.ts');
const hostSource = source('../src/content/smooth-scroll.ts');
const handlersSource = source('../src/content/smooth-scroll-handlers.ts');
const engineSource = source('../src/tools/smooth-scroll/engine.ts');
const sidepanelSource = source('../src/entry/sidepanel-scroll.ts');

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

	test('keeps wheel ownership synchronous through the engine admission boolean', () => {
		const wheelStart = handlersSource.indexOf('export function onWheel');
		const mouseDownStart = handlersSource.indexOf('export function onMouseDown', wheelStart);
		const wheel = handlersSource.slice(wheelStart, mouseDownStart);
		const scrollCall = wheel.indexOf('!scrollTo(');
		const finalPreventDefault = wheel.lastIndexOf('e.preventDefault();');

		expect(wheelStart).toBeGreaterThanOrEqual(0);
		expect(mouseDownStart).toBeGreaterThan(wheelStart);
		expect(scrollCall).toBeGreaterThanOrEqual(0);
		expect(finalPreventDefault).toBeGreaterThan(scrollCall);
		expect(wheel).toContain('yieldWheelToNative();');
		expect(engineSource).toContain('export function scrollTo(');
		expect(engineSource).not.toContain('export async function scrollTo(');
		expect(engineSource).toContain('matchesScrollAdmission(admission, target, y)');
		expect(engineSource).toContain('return true;');
	});

	test('keeps SidePanel wheel ownership on the same synchronous admission contract', () => {
		const wheelStart = sidepanelSource.indexOf('function onWheel');
		const keydownStart = sidepanelSource.indexOf('function onKeydown', wheelStart);
		const wheel = sidepanelSource.slice(wheelStart, keydownStart);
		const scrollCall = wheel.indexOf('!scrollTo(');
		const finalPreventDefault = wheel.lastIndexOf('e.preventDefault();');

		expect(wheelStart).toBeGreaterThanOrEqual(0);
		expect(keydownStart).toBeGreaterThan(wheelStart);
		expect(scrollCall).toBeGreaterThanOrEqual(0);
		expect(finalPreventDefault).toBeGreaterThan(scrollCall);
		expect(sidepanelSource).toContain('scrollTo(route.target, 0, deltaY, route.admission)');
	});
});
