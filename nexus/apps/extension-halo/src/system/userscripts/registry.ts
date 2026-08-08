// goal: UserScripts dynamic registration using chrome.userScripts API (Chrome 120+)
// eff: One persistent registry reconciled from three explicit ownership classes

import {
	MODULE_INSTALLATION_STORAGE_PREFIX,
	isOptionalPackagedModuleStoredEnabled,
	moduleInstallationStorageKey,
} from '../../kernel/core/module-installation-runtime';
import type { UserScript, UserScriptState } from './types';
import type { ScriptType } from './types';

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
	if (pattern === '*' || pattern === '*/*') return '*://*/*';
	if (pattern.startsWith('*://') || pattern.startsWith('http://') || pattern.startsWith('https://')) return pattern;
	if (pattern.includes('/')) return `*://${pattern}`;
	return `*://${pattern}/*`;
}

function toMatchPatterns(patterns: string[]): string[] {
	const result: string[] = [];
	for (const pattern of patterns) {
		const normalized = normalizePattern(pattern.trim());
		if (normalized?.includes('://')) result.push(normalized);
	}
	return result.length > 0 ? result : ['*://*/*'];
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
			const haloIds = registered
				.filter((script) => script.id.startsWith(SCRIPT_ID_PREFIX))
				.map((script) => script.id);
			if (haloIds.length > 0) await chrome.userScripts.unregister({ ids: haloIds });
		} catch (error) {
			failures.push(failureMessage('userScripts unregister failed', error));
		}
	}
	try {
		const registeredContent = await chrome.scripting.getRegisteredContentScripts();
		const haloContentIds = registeredContent
			.filter((script) => script.id.startsWith(SCRIPT_ID_PREFIX))
			.map((script) => script.id);
		if (haloContentIds.length > 0) await chrome.scripting.unregisterContentScripts({ ids: haloContentIds });
	} catch (error) {
		failures.push(failureMessage('content-script unregister failed', error));
	}
	if (failures.length > 0) throw new Error(failures.join('; '));
}

async function registerAllScripts(scripts: readonly UserScript[]): Promise<void> {
	const userScriptsToRegister: chrome.userScripts.RegisteredUserScript[] = [];
	const contentScriptsToRegister: chrome.scripting.RegisteredContentScript[] = [];
	for (const script of scripts) {
		if (!script.enabled) continue;
		const matches = toMatchPatterns(script.matches);
		const excludeMatches = script.excludeMatches?.length ? toMatchPatterns(script.excludeMatches) : undefined;
		const fullId = `${SCRIPT_ID_PREFIX}${script.id}`;
		const world = script.world || 'USER_SCRIPT';
		if (world === 'ISOLATED') {
			if (!script.filePath) continue;
			const contentScript: chrome.scripting.RegisteredContentScript = {
				id: fullId,
				matches,
				excludeMatches,
				runAt: toRunAt(script.runAt),
				allFrames: false,
				world: 'ISOLATED',
				persistAcrossSessions: true,
			};
			if (script.type === 'css') contentScript.css = [script.filePath];
			else contentScript.js = [script.filePath];
			contentScriptsToRegister.push(contentScript);
		} else {
			userScriptsToRegister.push({
				id: fullId,
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
	if (userScriptsToRegister.length > 0 && isUserScriptsAvailable()) {
		try { await chrome.userScripts.register(userScriptsToRegister); }
		catch (error) { failures.push(failureMessage('userScripts register failed', error)); }
	}
	if (contentScriptsToRegister.length > 0 && chrome.scripting?.registerContentScripts) {
		try { await chrome.scripting.registerContentScripts(contentScriptsToRegister); }
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
			if (script.managedBy === 'packaged-script' || script.saatToolId) {
				if (ownedModuleEnabled(script, moduleValues)) desired.push(script);
			}
		}
	}
	if (saatState.globalEnabled) {
		for (const script of saatState.scripts) {
			// The halo_saat_scripts container is registry-managed by definition;
			// managedBy is still persisted to make ownership explicit/migratable.
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

async function performRegisteredScriptSync(): Promise<void> {
	const stateResult = await chrome.storage.local.get([
		STORAGE_KEY,
		SAAT_STORAGE_KEY,
		USERSCRIPTS_MODULE_KEY,
	]);
	const userState: UserScriptState = stateResult[STORAGE_KEY] || { scripts: [], globalEnabled: true };
	const saatState: UserScriptState = stateResult[SAAT_STORAGE_KEY] || { scripts: [], globalEnabled: true };
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

	// Registration is browser-persistent. Never layer a new desired generation
	// on top of an incompletely retired one.
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

function clearRecoveryTimer(): void {
	if (recoveryTimer) clearTimeout(recoveryTimer);
	recoveryTimer = null;
}

function resetRecovery(): void {
	clearRecoveryTimer();
	recoveryAttempt = 0;
}

function persistRecoveryNeeded(): void {
	void chrome.storage.local.set({ [RECOVERY_STORAGE_KEY]: true }).catch((error) => {
		console.warn(LOG_TAG, 'Failed to persist registry recovery marker', error);
	});
}

function clearPersistedRecovery(): void {
	void chrome.storage.local.remove(RECOVERY_STORAGE_KEY).catch((error) => {
		console.warn(LOG_TAG, 'Failed to clear registry recovery marker', error);
	});
}

function requestRegisteredScriptSync(reason: string): void {
	void syncRegisteredScripts().then(() => {
		resetRecovery();
		clearPersistedRecovery();
	}, (error: unknown) => {
		console.warn(LOG_TAG, `${reason} sync failed`, error);
		persistRecoveryNeeded();
		if (!registryInitialized || recoveryTimer || recoveryAttempt >= SYNC_RETRY_DELAYS_MS.length) return;
		const delay = SYNC_RETRY_DELAYS_MS[recoveryAttempt++] ?? 4_000;
		recoveryTimer = setTimeout(() => {
			recoveryTimer = null;
			requestRegisteredScriptSync('recovery');
		}, delay);
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
		if (
			!changes[STORAGE_KEY]
			&& !changes[SAAT_STORAGE_KEY]
			&& !includesModuleInstallationChange(changes)
		) return;
		// Persist the recovery intent before asynchronous reconciliation. If the
		// worker dies mid-sync, the next worker has a durable recovery signal.
		persistRecoveryNeeded();
		resetRecovery();
		requestRegisteredScriptSync('storage-change');
	};
	chrome.storage.onChanged.addListener(listener);
	recoverPersistentRegistryIfNeeded();
	return () => {
		chrome.storage.onChanged.removeListener(listener);
		registryInitialized = false;
		resetRecovery();
	};
}
