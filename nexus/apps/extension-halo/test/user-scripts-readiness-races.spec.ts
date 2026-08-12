import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function source(path: string): string {
	return readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
}

describe('UserScripts readiness race contracts', () => {
	test('registry receipt authority is invalidated by extension version changes', () => {
		const registry = source('system/userscripts/registry.ts');
		expect(registry).toContain('extensionVersion: chrome.runtime.getManifest().version');
		expect(registry).toContain('digestAuthority({');
		expect(registry).toContain('ensureUserScriptsRuntimeReady');
	});

	test('retired permission refreshes are explicit stale results, never previous readiness', () => {
		const hook = source('system/userscripts/hooks/useUserScripts.ts');
		expect(hook).toContain("type PermissionStatusResult = 'ready' | 'unavailable' | 'stale'");
		expect(hook).toContain("if (revision !== statusRevisionRef.current) return 'stale';");
		expect(hook).toContain("for (let attempt = 0; attempt < 3 && status === 'stale'; attempt += 1)");
		expect(hook).toContain("if (status === 'stale') return;");
		expect(hook).not.toContain('return runtimeAccessRef.current;');
	});

	test('every platform-available refresh crosses the idempotent Background receipt barrier', () => {
		const hook = source('system/userscripts/hooks/useUserScripts.ts');
		const platformIndex = hook.indexOf('if (!platformAvailable)');
		const barrierIndex = hook.indexOf('await ensureBackgroundRegistryReady();', platformIndex);
		const readyIndex = hook.indexOf('setHasPermission(true);', barrierIndex);
		expect(platformIndex).toBeGreaterThanOrEqual(0);
		expect(barrierIndex).toBeGreaterThan(platformIndex);
		expect(readyIndex).toBeGreaterThan(barrierIndex);
		expect(hook).not.toContain('if (!runtimeAccessRef.current) {');
	});

	test('committed script authority changes trigger readiness revalidation', () => {
		const hook = source('system/userscripts/hooks/useUserScripts.ts');
		expect(hook).toContain('scriptAuthorityRevision');
		expect(hook).toContain('setScriptAuthorityRevision((revision) => revision + 1)');
		expect(hook).toContain('[scriptAuthorityRevision, refreshPermissionStatus]');
		expect(hook).toContain('Failed to revalidate registry authority');
	});
});
