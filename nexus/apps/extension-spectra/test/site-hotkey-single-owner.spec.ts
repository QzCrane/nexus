import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const leanHostSource = readFileSync(
	new URL('../src/content/input/lean-site-hotkey-host.ts', import.meta.url),
	'utf8',
);
const heavyListenerSource = readFileSync(
	new URL('../src/content/input/hotkey-listener.ts', import.meta.url),
	'utf8',
);
const adapterSource = readFileSync(
	new URL('../src/background/site-hotkey-loader-adapter.ts', import.meta.url),
	'utf8',
);

describe('configured-site hotkey single physical owner', () => {
	test('revision-2 lean host exposes active ownership in the isolated-world realm', () => {
		expect(leanHostSource).toContain('revision: 2;');
		expect(leanHostSource).toContain('readonly active: boolean;');
		expect(leanHostSource).toContain('get active() { return !disposed && bindingByChord.size > 0; }');
		expect(leanHostSource).toContain('existing?.revision !== 2');
	});

	test('transient heavy runtime cannot see configured sites while the lean host is active', () => {
		expect(heavyListenerSource).toContain('__SPECTRA_LEAN_SITE_HOTKEY_HOST__');
		expect(heavyListenerSource).toContain('marker?.revision === 2 && marker.active === true');
		expect(heavyListenerSource).toContain('if (leanSiteHotkeyOwnsConfiguredBindings()) return null;');
		expect(heavyListenerSource.indexOf('leanSiteHotkeyOwnsConfiguredBindings()')).toBeLessThan(
			heavyListenerSource.indexOf('location.hostname === lastHostname'),
		);
	});

	test('Background still explicitly suspends/resumes a resident heavy listener around ownership transitions', () => {
		expect(adapterSource).toContain('{ ...settings, sites: {} }');
		expect(adapterSource).toContain('await leasePort.ensure(capability);');
		expect(adapterSource).toContain('await projectHeavySiteHotkeySettings(tabId, documentId, settings, false);');
		expect(adapterSource).toContain('leasePort.release(capability);');
	});
});
