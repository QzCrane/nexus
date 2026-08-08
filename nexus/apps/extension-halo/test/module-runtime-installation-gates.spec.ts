import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { OPTIONAL_MODULES } from '../src/kernel/registry/module-registry';

const GATED_PERSISTENT_OPTIONAL_MODULES = new Set(['smooth-scroll', 'userscripts']);

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
	const smoothScroll = readFileSync(new URL('../src/content/smooth-scroll.ts', import.meta.url), 'utf8');
	const registry = readFileSync(new URL('../src/system/userscripts/registry.ts', import.meta.url), 'utf8');
	const engine = readFileSync(new URL('../src/system/userscripts/engine.ts', import.meta.url), 'utf8');
	for (const [name, source] of [
		['smooth-scroll', smoothScroll],
		['userscripts-registry', registry],
		['userscripts-engine', engine],
	] as const) {
		expect(source, name).toContain('module-installation-runtime');
		expect(source, name).not.toContain('module-manager');
		expect(source, name).not.toContain('module-registry');
	}
});
