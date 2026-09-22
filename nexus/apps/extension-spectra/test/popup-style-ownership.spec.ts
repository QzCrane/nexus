import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const appDir = resolve(import.meta.dir, '..');

function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(directory, entry.name);
		return entry.isDirectory()
			? sourceFiles(path)
			: entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
	});
}

function explicitClassOwners(sources: readonly string[]): Set<string> {
	const owners = new Set<string>();
	for (const source of sources) {
		for (const match of source.matchAll(/\bclass\s*=\s*["']([^"']*)["']/gu)) {
			for (const name of match[1]?.split(/\s+/u) ?? []) if (name) owners.add(name);
		}
		for (const match of source.matchAll(/\.className\s*=\s*["']([^"']*)["']/gu)) {
			for (const name of match[1]?.split(/\s+/u) ?? []) if (name) owners.add(name);
		}
		for (const call of source.matchAll(/\.classList\.(?:add|remove|toggle|replace)\(([^)]*)\)/gu)) {
			for (const argument of call[1]?.matchAll(/["']([A-Za-z_][A-Za-z0-9_-]*)["']/gu) ?? []) {
				if (argument[1]) owners.add(argument[1]);
			}
		}
	}
	return owners;
}

describe('Popup style ownership', () => {
	test('keeps every shipped class selector bound to static markup or a runtime owner', () => {
		const css = readFileSync(resolve(appDir, 'public/popup.css'), 'utf8');
		const runtime = [
			readFileSync(resolve(appDir, 'public/popup.html'), 'utf8'),
			...['popup', 'remote', 'shared'].flatMap((directory) => (
				sourceFiles(resolve(appDir, `src/${directory}`)).map((path) => readFileSync(path, 'utf8'))
			)),
		].join('\n');
		const selectors = [...css.matchAll(/(?<![\w-])\.([A-Za-z_][A-Za-z0-9_-]*)/gu)]
			.map((match) => match[1])
			.filter((selector): selector is string => selector !== undefined);
		// `showPopupToast()` owns this class through its finite `tone` union.
		const generated = new Set(['popup-toast-error']);
		const unowned = [...new Set(selectors)]
			.filter((selector) => !generated.has(selector) && !runtime.includes(selector))
			.sort();
		expect(unowned).toEqual([]);
	});

});

describe('Options style ownership', () => {
	test('keeps every shipped class selector bound to static markup or a runtime owner', () => {
		const css = readFileSync(resolve(appDir, 'public/options.css'), 'utf8');
		const sources = [
			readFileSync(resolve(appDir, 'public/options.html'), 'utf8'),
			...['options', 'shared'].flatMap((directory) => (
				sourceFiles(resolve(appDir, `src/${directory}`)).map((path) => readFileSync(path, 'utf8'))
			)),
		];
		const owners = explicitClassOwners(sources);
		const selectors = [...css.matchAll(/(?<![\w-])\.([A-Za-z_][A-Za-z0-9_-]*)/gu)]
			.map((match) => match[1])
			.filter((selector): selector is string => selector !== undefined);
		const unowned = [...new Set(selectors)]
			.filter((selector) => !owners.has(selector))
			.sort();
		expect(unowned).toEqual([]);
	});

});
