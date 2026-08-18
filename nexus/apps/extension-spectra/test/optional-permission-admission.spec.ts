import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function source(relativePath: string): string {
	return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

const manifest = JSON.parse(source('public/manifest.json')) as {
	permissions?: string[];
	optional_permissions?: string[];
};
const permissionOwner = source('src/shared/optional-permission-admission.ts');
const clickGate = source('src/shared/optional-permission-click-gate.ts');
const userScriptsOptions = source('src/options/userscripts.ts');
const popupDownloadsOwner = source('src/popup/optional-permission-ui.ts');
const optionsDownloadsOwner = source('src/options/optional-permission-ui.ts');
const userScriptsBackground = source('src/background/handlers/user-scripts.ts');
const screenshotBackground = source('src/background/handlers/screenshot.ts');

describe('SPECTRA optional capability admission', () => {
	test('keeps non-core userScripts and downloads out of install-time permissions', () => {
		expect(manifest.permissions).not.toContain('userScripts');
		expect(manifest.permissions).not.toContain('downloads');
		expect([...(manifest.optional_permissions ?? [])].sort()).toEqual(['downloads', 'userScripts']);
	});

	test('keeps chrome.permissions.request in the shared direct user-gesture owner', () => {
		expect(permissionOwner).toContain('return chrome.permissions.request({ permissions: [permission] });');
		expect(permissionOwner.indexOf('chrome.permissions.request')).toBeLessThan(
		permissionOwner.indexOf('hasOptionalPermission(permission)'),
	);
		expect(clickGate).toContain('event.stopImmediatePropagation()');
		expect(clickGate).toContain('const request = requestOptionalPermission(permission);');
		expect(clickGate).toContain('button.click();');
	});

	test('owns userScripts admission at the explicit Options enable gesture', () => {
		expect(userScriptsOptions).toContain("requestOptionalPermission('userScripts')");
		expect(userScriptsOptions).toContain("enableBtn?.addEventListener('click'");
		expect(userScriptsOptions).not.toContain('chrome.permissions.request');
	});

	test('owns downloads admission at Popup Screenshot and Options Screenshot-hotkey save gestures', () => {
		expect(popupDownloadsOwner).toContain("selector: '.sp-btn[data-action=\"screenshot\"]'");
		expect(popupDownloadsOwner).toContain("permission: 'downloads'");
		expect(optionsDownloadsOwner).toContain("selector: '#modal-save'");
		expect(optionsDownloadsOwner).toContain("action.value === 'screenshot'");
		expect(optionsDownloadsOwner).toContain("permission: 'downloads'");
	});

	test('keeps Background consume-only and fail-closed for both optional permissions', () => {
		expect(userScriptsBackground).toContain('await chrome.userScripts.getScripts()');
		expect(userScriptsBackground).toContain('if (!available)');
		expect(userScriptsBackground).not.toContain('chrome.permissions.request');
		expect(screenshotBackground).toContain("chrome.permissions.contains({ permissions: ['downloads'] })");
		expect(screenshotBackground).toContain('Screenshot saving needs Downloads permission.');
		expect(screenshotBackground).not.toContain('chrome.permissions.request');
	});
});
