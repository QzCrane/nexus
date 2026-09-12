import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { OPTIONAL_MODULES } from '../src/kernel/registry/module-registry';

const GATED_PERSISTENT_OPTIONAL_MODULES = new Set(['smooth-scroll', 'userscripts', 'pomodoro']);

function ownsRuntimeOutsideVisiblePanel(module: (typeof OPTIONAL_MODULES)[number]): boolean {
	const background = module.background;
	if (!background) return false;
	return background.activeOnly === false
		|| background.sourceFile.startsWith('content/')
		|| background.sourceFile.startsWith('entry/');
}

test('every persistent optional runtime has an explicit installation gate owner', () => {
	const persistent = OPTIONAL_MODULES
		.filter(ownsRuntimeOutsideVisiblePanel)
		.map((module) => module.id)
		.sort();
	expect(persistent).toEqual([...GATED_PERSISTENT_OPTIONAL_MODULES].sort());
});

test('gated runtime owners import the tiny installation contract, not ModuleManager/registry', () => {
	const sources = [
		readFileSync(new URL('../src/content/smooth-scroll.ts', import.meta.url), 'utf8'),
		readFileSync(new URL('../src/system/userscripts/registry.ts', import.meta.url), 'utf8'),
		readFileSync(new URL('../src/system/userscripts/engine.ts', import.meta.url), 'utf8'),
		// Pomodoro's persistent runtime is the shared Background deadline
		// coordinator (its manifest sourceFile); the gate is the module
		// installation check inside the pomodoro job path.
		readFileSync(new URL('../src/kernel/core/deadline-jobs/coordinator.ts', import.meta.url), 'utf8'),
	];
	for (const source of sources) {
		expect(source).toContain('module-installation-runtime');
		expect(source).not.toContain('module-manager');
		expect(source).not.toContain('module-registry');
	}
});
