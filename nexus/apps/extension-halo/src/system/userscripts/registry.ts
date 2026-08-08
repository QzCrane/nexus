// goal: browser-persistent UserScripts registry with explicit runtime ownership
// inv: custom, packaged-script, and SaaT runtimes reconcile from their own authorities and recover durably

import {
	MODULE_INSTALLATION_STORAGE_PREFIX,
	isOptionalPackagedModuleStoredEnabled,
	moduleInstallationStorageKey,
} from '../../kernel/core/module-installation-runtime';
import type { ScriptType, UserScript, UserScriptState } from './types';

const LOG_TAG = '[HALO:UserScripts:Registry]';
const STORAGE_KEY = 'halo_userscripts';
const SAAT_STORAGE_KEY = 'halo_saat_scripts';
const USERSCRIPTS_MODULE_KEY = moduleInstallationStorageKey('userscripts');
const RECOVERY_STORAGE_KEY = 'halo_userscripts_registry_dirty_v1';
const SCRIPT_ID_PREFIX = 'halo-userscript-';
const SYNC_RETRY_DELAYS_MS = [250, 1_000, 4_000] as const;

function isUserScriptsAvailable(): boolean {
	return typeof chrome.userScripts !== 'undefined';
}

function normalizePattern(pattern: string): string {
	const trimmed = pattern.trim();
	if (!trimmed) throw new Error('Empty match pattern');
	if (trimmed === '*' || trimmed === '*/*') return '*://*/*';
	if (trimmed.startsWith('*://') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
		return trimmed;
	}
	if (trimmed.includes('/')) return `*://${trimmed}`;
	return `*://${trimmed}/*`;
}

function toMatchPatterns(patterns: readonly string[]): string[] {
	if (patterns.length === 0) throw new Error('At least one match pattern is required');
	const result = patterns.map(normalizePattern);
	if (result.length === 0) throw new Error('At least one valid match pattern is required');
	return result;
}

function escapeForJsString(value: string): string {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/'/g, "\\'")
		.replace(/"/g, '\\"')
		.replace(/\n/g, '\\n')
		.replace(/\r/g, '\\r');
}

function wrapForMainWorld(code: string, name: string, type: ScriptType): string {
	const safeName = escapeForJsString(name);
	if (type === 'css') {
		const safeCss = escapeForJsString(code);
		return [
			'(function() {',
			'    try {',
			'        const style = document.createElement("style");',
			`        style.textContent = '${safeCss}';`,
			`        style.setAttribute("data-halo-script", '${safeName}');`,
			'        (document.head || document.documentElement).appendChild(style);',
			`        console.log("[HALO Script] ${safeName} CSS injected");`,
			`    } catch(e) { console.error("[HALO Script] ${safeName} CSS failed:", e); }`,
			'})();',
		].join('\n');
	}
	return [
		'(function() {',
		'    try {',
		// biome-ignore lint/style/useTemplate: user code may contain template syntax
		'        ' + code,
		`        console.log("[HALO Script] ${safeName} executed");`,
		`    } catch(e) { console.error("[HALO Script] ${safeName} failed:", e); }`,
		'})();',
	].join('\n');
}

function toRunAt(runAt: string): 'document_start' | 'document_end' | 'document_idle' {
	if (runAt === 'document_start') return 'document_start';
	if (runAt === 'document_end') return 'document_end';
	return 'document_idle';
}

function failureMessage(label: string, error: unknown): string {
	return `${label}: ${error instanceof Error ? error.message : String(error)}`;
}

async function unregisterAllScripts(): Promise<void> {
	const failures: string[] = [];
	if (isUserScriptsAvailable()) {
		try {
			const registered = await chrome.userScripts.getScripts();
			const ids = registered
				.filter((script) => script.id.startsWith(SCRIPT_ID_PREFIX))
				.map((script) => script.id);
			if (ids.length > 0) await chrome.userScripts.unregister({ ids });
		} catch (error) {
			failures.push(failureMessage('userScripts unregister failed', error));
		}
	}
	try {
		const registered = await chrome.scripting.getRegisteredContentScripts();
		const ids = registered
			.filter((script) => script.id.startsWith(SCRIPT_ID_PREFIX))
			.map((script) => script.id);
		if (ids.length > 0) await chrome.scripting.unregisterContentScripts({ ids });
	} catch (error) {
		failures.push(failureMessage('content-script unregister failed', error));
	}
	if (failures.length > 0) throw new Error(failures.join('; '));
}

async function registerAllScripts(scripts: readonly UserScript[]): Promise<void> {
	const userScripts: chrome.userScripts.RegisteredUserScript[] = [];
	const contentScripts: chrome.scripting.RegisteredContentScript[] = [];
	for (const script of scripts) {
		if (!script.enabled) continue;
		const matches = toMatchPatterns(script.matches);
		const excludeMatches = script.excludeMatches?.length
			? script.excludeMatches.map(normalizePattern)
			: undefined;
		const id = `${SCRIPT_ID_PREFIX}${script.id}`;
		const world = script.world || 'USER_SCRIPT';
		if (world === 'ISOLATED') {
			if (!script.filePath) throw new Error(`ISOLATED script ${script.id} is missing filePath`);
			const contentScript: chrome.scripting.RegisteredContentScript = {
				id,
				matches,
				excludeMatches,
				runAt: toRunAt(script.runAt),
				allFrames: false,
				world: 'ISOLATED',
				persistAcrossSessions: true,
			};
			if (script.type === 'css') contentScript.css = [script.filePath];
			else contentScript.js = [script.filePath];
			contentScripts.push(contentScript);
		} else {
			userScripts.push({
				id,
				matches,
				excludeMatches,
				js: [{ code: wrapForMainWorld(script.code, script.name, script.type) }],
				runAt: toRunAt(script.runAt),
				allFrames: false,
				world: 'USER_SCRIPT',
			});
		}
	}

	const failures: string[] = [];
	if (userScripts.length > 0 && isUserScriptsAvailable()) {
		try { await chrome.userScripts.register(userScripts); }
		catch (error) { failures.push(failureMessage('userScripts register failed', error)); }
	}
	if (contentScripts.length > 0 && chrome.scripting?.registerContentScripts) {
		try { await chrome.scripting.registerContentScripts(contentScripts); }
		catch (error) { failures.push(failureMessage('content-script register failed', error)); }
	}
	if (failures.length > 0) throw new Error(failures.join('; '));
}

function isCustomUserScript(script: UserScript): boolean {
	return !script.saatToolId && script.managedBy === undefined;
}

function ownedModuleEnabled(
	script: UserScript,
	moduleValues: Record<string, unknown>,
): boolean {
	if (!script.saatToolId) return false;
	if (script.moduleBuiltIn === true) return true;
	const key = moduleInstallationStorageKey(script.saatToolId);
	return isOptionalPackagedModuleStoredEnabled(
		moduleValues[key],
		Object.hasOwn(moduleValues, key),
	);
}

export function resolveDesiredRegisteredScripts(
	userState: UserScriptState,
	saatState: UserScriptState,
	userscriptsModuleEnabled: boolean,
	moduleValues: Record<string, unknown>,
): UserScript[] {
	const desired: UserScript[] = [];
	if (userState.globalEnabled) {
		for (const script of userState.scripts) {
			if (isCustomUserScript(script)) {
				if (userscriptsModuleEnabled) desired.push(script);
				continue;
			}
			if ((script.managedBy === 'packaged-script' || script.saatToolId)
				&& ownedModuleEnabled(script, moduleValues)) {
				desired.push(script);
			}
		}
	}
	if (saatState.globalEnabled) {
		for (const script of saatState.scripts) {
			if (ownedModuleEnabled(script, moduleValues)) desired.push(script);
		}
	}
	return desired;
}

function moduleKeysForManagedScripts(
	userState: UserScriptState,
	saatState: UserScriptState,
): string[] {
	const keys = new Set<string>();
	for (const script of [...userState.scripts, ...saatState.scripts]) {
		if (!script.saatToolId || script.moduleBuiltIn === true) continue;
		keys.add(moduleInstallationStorageKey(script.saatToolId));
	}
	return [...keys];
}

function readState(value: unknown): UserScriptState {
	if (value === undefined) return { scripts: [], globalEnabled: true };
	if (!value || typeof value !== 'object') return { scripts: [], globalEnabled: false };
	const candidate = value as Partial<UserScriptState>;
	if (!Array.isArray(candidate.scripts) || typeof candidate.globalEnabled !== 'boolean') {
		return { scripts: [], globalEnabled: false };
	}
	return candidate as UserScriptState;
}

async function performRegisteredScriptSync(): Promise<void> {
	const stateResult = await chrome.storage.local.get([
		STORAGE_KEY,
		SAAT_STORAGE_KEY,
		USERSCRIPTS_MODULE_KEY,
	]);
	const userState = readState(stateResult[STORAGE_KEY]);
	const saatState = readState(stateResult[SAAT_STORAGE_KEY]);
	const userscriptsModuleEnabled = isOptionalPackagedModuleStoredEnabled(
		stateResult[USERSCRIPTS_MODULE_KEY],
		Object.hasOwn(stateResult, USERSCRIPTS_MODULE_KEY),
	);
	const moduleKeys = moduleKeysForManagedScripts(userState, saatState);
	const moduleValues = moduleKeys.length > 0 ? await chrome.storage.local.get(moduleKeys) : {};
	const desired = resolveDesiredRegisteredScripts(
		userState,
		saatState,
		userscriptsModuleEnabled,
		moduleValues,
	);
	await unregisterAllScripts();
	await registerAllScripts(desired);
}

let syncLoop: Promise<void> | null = null;
let syncPending = false;

async function runRegisteredScriptSyncLoop(): Promise<void> {
	do {
		syncPending = false;
		await performRegisteredScriptSync();
	} while (syncPending);
}

export async function syncRegisteredScripts(): Promise<void> {
	syncPending = true;
	if (!syncLoop) syncLoop = runRegisteredScriptSyncLoop().finally(() => { syncLoop = null; });
	return syncLoop;
}

let registryInitialized = false;
let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
let recoveryAttempt = 0;
let recoveryRequest: Promise<void> | null = null;

function resetRecoveryTimer(): void {
	if (recoveryTimer) clearTimeout(recoveryTimer);
	recoveryTimer = null;
	recoveryAttempt = 0;
}

async function markRecoveryNeeded(): Promise<void> {
	await chrome.storage.local.set({ [RECOVERY_STORAGE_KEY]: true });
}

async function clearRecoveryNeeded(): Promise<void> {
	await chrome.storage.local.remove(RECOVERY_STORAGE_KEY);
}

function scheduleRecovery(): void {
	if (!registryInitialized || recoveryTimer || recoveryAttempt >= SYNC_RETRY_DELAYS_MS.length) return;
	const delay = SYNC_RETRY_DELAYS_MS[recoveryAttempt++] ?? 4_000;
	recoveryTimer = setTimeout(() => {
		recoveryTimer = null;
		requestRegisteredScriptSync('recovery');
	}, delay);
}

function requestRegisteredScriptSync(reason: string): void {
	if (recoveryRequest) {
		syncPending = true;
		return;
	}
	recoveryRequest = (async () => {
		// Dirty must become durable before reconciliation starts. The marker is
		// removed only after the complete serialized sync loop succeeds, so a
		// worker termination or a late storage write cannot leave false-clean state.
		await markRecoveryNeeded();
		await syncRegisteredScripts();
		await clearRecoveryNeeded();
		resetRecoveryTimer();
	})().catch(async (error: unknown) => {
		console.warn(LOG_TAG, `${reason} sync failed`, error);
		try { await markRecoveryNeeded(); }
		catch (markerError) { console.warn(LOG_TAG, 'Failed to persist registry recovery marker', markerError); }
		scheduleRecovery();
	}).finally(() => {
		recoveryRequest = null;
		if (syncPending && registryInitialized) requestRegisteredScriptSync('trailing');
	});
}

function recoverPersistentRegistryIfNeeded(): void {
	void chrome.storage.local.get([USERSCRIPTS_MODULE_KEY, RECOVERY_STORAGE_KEY]).then((result) => {
		if (!registryInitialized) return;
		const userscriptsModuleEnabled = isOptionalPackagedModuleStoredEnabled(
			result[USERSCRIPTS_MODULE_KEY],
			Object.hasOwn(result, USERSCRIPTS_MODULE_KEY),
		);
		if (!userscriptsModuleEnabled || result[RECOVERY_STORAGE_KEY] === true) {
			requestRegisteredScriptSync('worker-startup-recovery');
		}
	}).catch((error) => {
		if (!registryInitialized) return;
		console.warn(LOG_TAG, 'Failed to inspect registry recovery state', error);
		requestRegisteredScriptSync('worker-startup-fail-closed');
	});
}

function includesModuleInstallationChange(
	changes: Record<string, chrome.storage.StorageChange>,
): boolean {
	return Object.keys(changes).some((key) => key.startsWith(MODULE_INSTALLATION_STORAGE_PREFIX));
}

export function initUserScriptsRegistry(): () => void {
	if (registryInitialized) return () => {};
	registryInitialized = true;
	const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
		if (area !== 'local') return;
		if (!changes[STORAGE_KEY]
			&& !changes[SAAT_STORAGE_KEY]
			&& !includesModuleInstallationChange(changes)) return;
		requestRegisteredScriptSync('storage-change');
	};
	chrome.storage.onChanged.addListener(listener);
	recoverPersistentRegistryIfNeeded();
	return () => {
		chrome.storage.onChanged.removeListener(listener);
		registryInitialized = false;
		resetRecoveryTimer();
	};
}

export const userScriptsRegistryTestApi = {
	RECOVERY_STORAGE_KEY,
	SYNC_RETRY_DELAYS_MS,
	toMatchPatterns,
};
