import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const BUS_IMPORT = 'subscribeHaloStorageChanges';
const DIRECT_LISTENER = 'chrome.storage.onChanged.addListener';

const SIDE_PANEL_STORAGE_SURFACES = [
	'../src/entry/sidepanel-scroll.ts',
	'../src/i18n/i18n-core.ts',
	'../src/kernel/hooks/use-settings.ts',
	'../src/kernel/hooks/use-tool-state.ts',
	'../src/components/sidepanel/ActiveServicesContext.tsx',
	'../src/system/userscripts/storage-authority.ts',
	'../src/tools/clipboard/panel.tsx',
] as const;

test('shared SidePanel storage observers use the one realm-level change bus', () => {
	for (const relativePath of SIDE_PANEL_STORAGE_SURFACES) {
		const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
		expect(source).toContain(BUS_IMPORT);
		expect(source).not.toContain(DIRECT_LISTENER);
	}
});

test('the storage bus is a global realm singleton rather than a per-bundle module singleton', () => {
	const source = readFileSync(
		new URL('../src/kernel/core/storage-change-bus.ts', import.meta.url),
		'utf8',
	);
	expect(source).toContain("const GLOBAL_KEY = '__HALO_STORAGE_CHANGE_BUS_V1__';");
	expect(source).toContain('globalThis as BusGlobal');
	expect(source).toContain('chrome.storage.onChanged.addListener(state.onStorageChanged)');
	expect(source).toContain('chrome.storage.onChanged.removeListener(state.onStorageChanged)');
	expect(source).toContain('for (const subscriber of [...state.subscribers])');
});
