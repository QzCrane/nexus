import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function source(path: string): string {
	return readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
}

describe('UserScripts readiness race contracts', () => {
	test('registry receipt authority requires the current extension and descriptor projection versions', () => {
		const registry = source('system/userscripts/registry.ts');
		expect(registry).toContain("const SAAT_DESCRIPTOR_VERSION_KEY = 'halo_userscripts_saat_descriptor_version_v1'");
		expect(registry).toContain('const extensionVersion = chrome.runtime.getManifest().version');
		expect(registry).toContain('const descriptorVersion = stateResult[SAAT_DESCRIPTOR_VERSION_KEY]');
		expect(registry).toContain('if (descriptorVersion !== extensionVersion)');
		expect(registry).toContain('saatDescriptorVersion: descriptorVersion');
		expect(registry).toContain('digestAuthority({');
		expect(registry).toContain('ensureUserScriptsRuntimeReady');
	});

	test('install-time readiness cannot become current before generated SaaT descriptors are synchronized', () => {
		const background = source('entry/background.ts');
		const descriptorSyncIndex = background.indexOf('await syncSaaTTools(await loadScriptRuntimeDescriptors());');
		const markerIndex = background.indexOf('await markSaaTDescriptorProjectionCurrent();');
		const registrySyncIndex = background.indexOf('await syncRegisteredScripts();', markerIndex);
		expect(descriptorSyncIndex).toBeGreaterThanOrEqual(0);
		expect(markerIndex).toBeGreaterThan(descriptorSyncIndex);
		expect(registrySyncIndex).toBeGreaterThan(markerIndex);
		expect(background).toContain('if (descriptorProjectionCurrent)');
	});

	test('storage events cross the idempotent receipt barrier instead of forcing every registry rebuild', () => {
		const registry = source('system/userscripts/registry.ts');
		const listenerIndex = registry.indexOf('export function initUserScriptsRegistry');
		const ensureIndex = registry.indexOf("requestRegisteredScriptEnsure('storage-change');", listenerIndex);
		expect(ensureIndex).toBeGreaterThan(listenerIndex);
		expect(registry).toContain('includesModuleInstallationChange(changes)');
		expect(registry).toContain('ensureRequestedGeneration');
		expect(registry).toContain('satisfied && ensureRequestedGeneration === targetGeneration');
		expect(registry.slice(listenerIndex)).not.toContain("requestRegisteredScriptSync('storage-change');");
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

	test('committed and owned global script authority changes trigger readiness revalidation', () => {
		const hook = source('system/userscripts/hooks/useUserScripts.ts');
		expect(hook).toContain('scriptAuthorityRevision');
		expect(hook).toContain('[scriptAuthorityRevision, refreshPermissionStatus]');
		expect(hook).toContain('Failed to revalidate registry authority');
		const globalToggleIndex = hook.indexOf('const newState = await toggleGlobalEnabled();');
		const revisionIndex = hook.indexOf('setScriptAuthorityRevision((revision) => revision + 1);', globalToggleIndex);
		expect(globalToggleIndex).toBeGreaterThanOrEqual(0);
		expect(revisionIndex).toBeGreaterThan(globalToggleIndex);
	});
});
