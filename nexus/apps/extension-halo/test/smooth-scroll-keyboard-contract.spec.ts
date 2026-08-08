import { describe, expect, test } from 'bun:test';
import esbuild from 'esbuild';
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

	test('observes at document start but activates only after settings hydration', () => {
		const observationIndex = hostSource.indexOf('attachObservationListeners();');
		const storageAwaitIndex = hostSource.indexOf(
			'await chrome.storage.sync.get([STORAGE_KEY])',
		);
		const activationIndex = hostSource.indexOf(
			'if (settings.enabled) attachActiveInputListeners();',
		);

		expect(observationIndex).toBeGreaterThanOrEqual(0);
		expect(storageAwaitIndex).toBeGreaterThan(observationIndex);
		expect(activationIndex).toBeGreaterThan(storageAwaitIndex);
		expect(hostSource).toContain(
			"window.addEventListener('keydown', onObservedKeydown, true)",
		);
		expect(hostSource).toContain(
			'if (!settingsHydrated || !settings.enabled) return;',
		);
		expect(hostSource).toContain(
			"window.addEventListener('blur', resetDocumentRuntime)",
		);
		expect(hostSource).not.toContain("addEventListener('DOMContentLoaded'");
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

	test('attributes the production-shaped static bundle to retained source modules', async () => {
		const extensionRoot = fileURLToPath(new URL('../', import.meta.url));
		const result = await esbuild.build({
			absWorkingDir: extensionRoot,
			entryPoints: ['src/entry/content-smooth-scroll.ts'],
			outfile: 'smooth-scroll-attribution.js',
			bundle: true,
			treeShaking: true,
			minify: true,
			legalComments: 'none',
			sourcemap: false,
			write: false,
			metafile: true,
			define: { 'process.env.NODE_ENV': '"production"' },
			pure: ['console.debug', 'console.info', 'console.log'],
			drop: ['debugger'],
			loader: { '.ts': 'ts', '.tsx': 'tsx' },
		});

		const contributors = new Map<string, number>();
		let totalBytes = 0;
		for (const output of Object.values(result.metafile.outputs)) {
			totalBytes += output.bytes;
			for (const [input, stats] of Object.entries(output.inputs ?? {})) {
				contributors.set(input, (contributors.get(input) ?? 0) + (stats.bytesInOutput ?? 0));
			}
		}
		const ranked = [...contributors.entries()]
			.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));

		expect(totalBytes).toBeGreaterThan(0);
		expect(ranked.some(([input]) => input.endsWith('tools/smooth-scroll/engine.ts'))).toBe(true);
		process.stdout.write(
			`[smooth-scroll-attribution] total=${totalBytes} ` +
			`${ranked.slice(0, 12).map(([input, bytes]) => `${input}:${bytes}`).join(' | ')}\n`,
		);
	});
});
