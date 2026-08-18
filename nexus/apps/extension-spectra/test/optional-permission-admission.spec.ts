import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(
	new URL('../public/manifest.json', import.meta.url),
	'utf8',
)) as { permissions?: string[]; optional_permissions?: string[] };
const optionsOwner = readFileSync(
	new URL('../src/options/userscripts.ts', import.meta.url),
	'utf8',
);
const backgroundOwner = readFileSync(
	new URL('../src/background/handlers/user-scripts.ts', import.meta.url),
	'utf8',
);

describe('SPECTRA optional capability admission', () => {
	test('keeps userScripts out of install-time permissions', () => {
		expect(manifest.permissions).not.toContain('userScripts');
		expect(manifest.optional_permissions).toContain('userScripts');
	});

	test('owns the permission request at the explicit Options enable gesture', () => {
		expect(optionsOwner).toContain("const USER_SCRIPTS_PERMISSION = 'userScripts'");
		expect(optionsOwner).toContain('chrome.permissions.request({ permissions: [USER_SCRIPTS_PERMISSION] })');
		expect(optionsOwner).toContain("enableBtn?.addEventListener('click'");
		const requestOwner = optionsOwner.slice(optionsOwner.indexOf('async function requestUserScriptsCapability'));
		expect(requestOwner.indexOf('chrome.permissions.request')).toBeLessThan(requestOwner.indexOf('checkUserScriptsAvailable()'));
	});

	test('keeps Background fail-closed when permission or platform toggle is unavailable', () => {
		expect(backgroundOwner).toContain('await chrome.userScripts.getScripts()');
		expect(backgroundOwner).toContain('if (!available)');
		expect(backgroundOwner).toContain('userScripts API not enabled');
		expect(backgroundOwner).not.toContain('chrome.permissions.request');
	});
});
