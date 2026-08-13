import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { bindOptionsRetry, showOptionsError, clearOptionsError } from '../src/options/status';

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');

afterEach(() => {
	if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
	else Reflect.deleteProperty(globalThis, 'document');
});

describe('Options failure presentation', () => {
	test('publishes and clears one accessible page-level error surface', () => {
		const surface = { hidden: true, textContent: '' };
		Object.defineProperty(globalThis, 'document', {
			configurable: true,
			value: { getElementById: (id: string) => id === 'options-status' ? surface : null },
		});
		showOptionsError(new Error('worker restarting'));
		expect(surface.hidden).toBe(false);
		expect(surface.textContent).toContain('worker restarting');
		clearOptionsError();
		expect(surface).toEqual({ hidden: true, textContent: '' });
	});

	test('does not convert failed settings loads into persisted defaults', () => {
		const siteEditor = readFileSync(new URL('../src/options/site-editor.ts', import.meta.url), 'utf8');
		const slotsEditor = readFileSync(new URL('../src/options/slots-editor.ts', import.meta.url), 'utf8');
		const entry = readFileSync(new URL('../src/options/index.ts', import.meta.url), 'utf8');
		expect(siteEditor).toContain('await getSettingsSnapshot(forceRefresh)');
		expect(siteEditor).not.toMatch(/getSettingsSnapshot\([^)]*\)\.catch\([^)]*DEFAULT/u);
		expect(slotsEditor).toContain('await getSettingsSnapshot()');
		expect(slotsEditor).not.toMatch(/getSettingsSnapshot\([^)]*\)\.catch\([^)]*DEFAULT/u);
		expect(entry).toContain('init().catch(showOptionsError)');
	});

	test('binds one explicit retry action for a failed initialization', () => {
		const button: { onclick: (() => void) | null } = { onclick: null };
		Object.defineProperty(globalThis, 'document', {
			configurable: true,
			value: { getElementById: (id: string) => id === 'options-retry' ? button : null },
		});
		let retries = 0;
		bindOptionsRetry(() => { retries += 1; });
		if (!button.onclick) throw new Error('Expected Options retry to be bound');
		button.onclick();
		expect(retries).toBe(1);
	});
});
