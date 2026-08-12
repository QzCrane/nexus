import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { userScriptsRegistryTestApi } from '../src/system/userscripts/registry';
import type { UserScript } from '../src/system/userscripts/types';

function source(path: string): string {
	return readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
}

function script(overrides: Partial<UserScript> = {}): UserScript {
	return {
		id: 'stable-runtime',
		name: 'Stable Runtime',
		description: 'display metadata',
		code: 'console.log(1);',
		enabled: true,
		type: 'javascript',
		matches: ['*://*/*'],
		runAt: 'document_idle',
		order: 0,
		runCount: 1,
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	};
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

	test('receipt fingerprints the physical registration generation, not UI telemetry', () => {
		const baseline = userScriptsRegistryTestApi.prepareRegistration([script()]);
		const telemetryOnly = userScriptsRegistryTestApi.prepareRegistration([script({
			description: 'different display metadata',
			runCount: 999,
			lastRun: 999_999,
			updatedAt: 999_999,
			category: 'different-category',
		})]);
		expect(telemetryOnly).toEqual(baseline);

		const registry = source('system/userscripts/registry.ts');
		const digestIndex = registry.indexOf('const digest = await digestAuthority({');
		const digestEnd = registry.indexOf('\n\t});', digestIndex);
		const digestBlock = registry.slice(digestIndex, digestEnd);
		expect(digestIndex).toBeGreaterThanOrEqual(0);
		expect(digestBlock).toContain('prepared,');
		expect(digestBlock).not.toContain('user: stateResult');
		expect(digestBlock).not.toContain('saat: stateResult');
		expect(digestBlock).not.toContain('moduleValues,');
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
		expect(hook).toContain('const snapshot = useUserScriptsStorageSnapshot();');
		expect(hook).toContain('if (!snapshot.ready) return;');
		expect(hook).toContain('[snapshot, refreshPermissionStatus]');
		expect(hook).toContain('Failed to revalidate registry authority');
		const globalToggleIndex = hook.indexOf('const newState = await toggleGlobalEnabled();');
		const nextHandlerIndex = hook.indexOf('const handleToggle', globalToggleIndex);
		const globalToggleSection = hook.slice(globalToggleIndex, nextHandlerIndex);
		expect(globalToggleIndex).toBeGreaterThanOrEqual(0);
		expect(globalToggleSection).not.toContain('loadScripts');
	});
});
