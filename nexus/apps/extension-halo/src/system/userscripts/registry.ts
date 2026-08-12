// goal: browser-persistent UserScripts registry with explicit runtime ownership
// inv: custom, packaged-script, and SaaT runtimes reconcile from their own authorities and recover durably

import {
	MODULE_INSTALLATION_STORAGE_PREFIX,
	isOptionalPackagedModuleStoredEnabled,
	moduleInstallationStorageKey,
} from '../../kernel/core/module-installation-runtime';
import type { ScriptType } from './types';
import {
	parseUserScriptsStorageValue,
	type UserScriptsSnapshotScript,
	type UserScriptsStorageSnapshot,
} from './storage-schema';

const LOG_TAG = '[HALO:UserScripts:Registry]';
const STORAGE_KEY = 'halo_userscripts';
const SAAT_STORAGE_KEY = 'halo_saat_scripts';
const USERSCRIPTS_MODULE_KEY = moduleInstallationStorageKey('userscripts');
const RECOVERY_STORAGE_KEY = 'halo_userscripts_registry_dirty_v1';
const SCRIPT_ID_PREFIX = 'halo-userscript-';
const SYNC_RETRY_DELAYS_MS = [250, 1_000, 4_000] as const;
const RECEIPT_VERSION = 2;
const DIRTY_RECEIPT = Object.freeze({ version: RECEIPT_VERSION, state: 'dirty' as const });

interface RegistryReceipt {
	version: typeof RECEIPT_VERSION;
	state: 'clean';
	digest: string;
}
interface RegistryAuthority {
	userState: UserScriptsStorageSnapshot;
	saatState: UserScriptsStorageSnapshot;
	userscriptsModuleEnabled: boolean;
	moduleValues: Record<string, unknown>;
	digest: string;
}
interface PreparedRegistration {
	userScripts: chrome.userScripts.RegisteredUserScript[];
	contentScripts: chrome.scripting.RegisteredContentScript[];
}

function isUserScriptsAvailable(): boolean {
	return typeof chrome.userScripts !== 'undefined';
}

function normalizePattern(pattern: string): string {
	const trimmed = pattern.trim();
	if (!trimmed) throw new Error('Empty match pattern');
	if (trimmed === '*' || trimmed === '*/*') return '*://*/*';
	if (trimmed.startsWith('*://') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
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

function canonicalize(value: unknown): string {
	if (value === undefined) return 'undefined';
	if (value === null || typeof value !== 'object') {
		const encoded = JSON.stringify(value);
		if (encoded === undefined) throw new TypeError(`Unsupported registry authority value: ${typeof value}`);
		return encoded;
	}
	if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
}

async function digestAuthority(value: unknown): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalize(value)));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isCustomUserScript(script: UserScriptsSnapshotScript): boolean {
	return script.saatToolId === undefined
		&& script.managedBy === undefined
		&& script.moduleBuiltIn === undefined;
}

function validateOwnershipContainers(
	userScripts: readonly UserScriptsSnapshotScript[],
	saatScripts: readonly UserScriptsSnapshotScript[],
): void {
	for (const script of userScripts) {
		if (isCustomUserScript(script)) continue;
		if (script.managedBy !== 'packaged-script'
			|| !script.saatToolId
			|| typeof script.moduleBuiltIn !== 'boolean') {
			throw new Error(`Invalid packaged-script ownership metadata: ${script.id}`);
		}
	}
	for (const script of saatScripts) {
		if (script.managedBy !== 'saat-tool'
			|| !script.saatToolId
			|| typeof script.moduleBuiltIn !== 'boolean') {
			throw new Error(`Invalid SaaT ownership metadata: ${script.id}`);
		}
	}
}

function ownedModuleEnabled(
	script: UserScriptsSnapshotScript,
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
	userState: Pick<UserScriptsStorageSnapshot, 'globalEnabled' | 'scripts'>,
	saatState: Pick<UserScriptsStorageSnapshot, 'globalEnabled' | 'scripts'>,
	userscriptsModuleEnabled: boolean,
	moduleValues: Record<string, unknown>,
): UserScriptsSnapshotScript[] {
	const desired: UserScriptsSnapshotScript[] = [];
	if (userState.globalEnabled) {
		for (const script of userState.scripts) {
			if (isCustomUserScript(script)) {
				if (userscriptsModuleEnabled) desired.push(script);
				continue;
			}
			if (script.managedBy === 'packaged-script' && ownedModuleEnabled(script, moduleValues)) desired.push(script);
		}
	}
	if (saatState.globalEnabled) {
		for (const script of saatState.scripts) {
			if (script.managedBy === 'saat-tool' && ownedModuleEnabled(script, moduleValues)) desired.push(script);
		}
	}
	return desired;
}

function moduleKeysForManagedScripts(
	userState: Pick<UserScriptsStorageSnapshot, 'scripts'>,
	saatState: Pick<UserScriptsStorageSnapshot, 'scripts'>,
): string[] {
	const keys = new Set<string>();
	for (const script of [...userState.scripts, ...saatState.scripts]) {
		if (!script.saatToolId || script.moduleBuiltIn === true) continue;
		keys.add(moduleInstallationStorageKey(script.saatToolId));
	}
	return [...keys];
}

async function readRegistryAuthority(): Promise<RegistryAuthority> {
	const stateResult = await chrome.storage.local.get([
		STORAGE_KEY,
		SAAT_STORAGE_KEY,
		USERSCRIPTS_MODULE_KEY,
	]);
	const userState = parseUserScriptsStorageValue(stateResult[STORAGE_KEY]);
	const saatState = parseUserScriptsStorageValue(stateResult[SAAT_STORAGE_KEY]);
	if (userState.failed || saatState.failed) throw new Error('Script registry persistence schema validation failed');
	validateOwnershipContainers(userState.scripts, saatState.scripts);
	const userscriptsModuleEnabled = isOptionalPackagedModuleStoredEnabled(
		stateResult[USERSCRIPTS_MODULE_KEY],
		Object.hasOwn(stateResult, USERSCRIPTS_MODULE_KEY),
	);
	const moduleKeys = moduleKeysForManagedScripts(userState, saatState);
	const moduleValues = moduleKeys.length > 0 ? await chrome.storage.local.get(moduleKeys) : {};
	const digest = await digestAuthority({
		user: stateResult[STORAGE_KEY] ?? null,
		saat: stateResult[SAAT_STORAGE_KEY] ?? null,
		userscriptsModule: Object.hasOwn(stateResult, USERSCRIPTS_MODULE_KEY)
			? stateResult[USERSCRIPTS_MODULE_KEY]
			: null,
		moduleValues,
	});
	return { userState, saatState, userscriptsModuleEnabled, moduleValues, digest };
}

function prepareRegistration(scripts: readonly UserScriptsSnapshotScript[]): PreparedRegistration {
	const userScripts: chrome.userScripts.RegisteredUserScript[] = [];
	const contentScripts: chrome.scripting.RegisteredContentScript[] = [];
	for (const script of scripts) {
		if (!script.enabled) continue;
		const matches = toMatchPatterns(script.matches);
		const excludeMatches = script.excludeMatches?.length ? script.excludeMatches.map(normalizePattern) : undefined;
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
	return { userScripts, contentScripts };
}

async function unregisterAllScripts(): Promise<void> {
	const failures: string[] = [];
	if (isUserScriptsAvailable()) {
		try {
			const registered = await chrome.userScripts.getScripts();
			const ids = registered.filter((script) => script.id.startsWith(SCRIPT_ID_PREFIX)).map((script) => script.id);
			if (ids.length > 0) await chrome.userScripts.unregister({ ids });
		} catch (error) { failures.push(failureMessage('userScripts unregister failed', error)); }
	}
	try {
		const registered = await chrome.scripting.getRegisteredContentScripts();
		const ids = registered.filter((script) => script.id.startsWith(SCRIPT_ID_PREFIX)).map((script) => script.id);
		if (ids.length > 0) await chrome.scripting.unregisterContentScripts({ ids });
	} catch (error) { failures.push(failureMessage('content-script unregister failed', error)); }
	if (failures.length > 0) throw new Error(failures.join('; '));
}

async function registerPrepared(prepared: PreparedRegistration): Promise<void> {
	const failures: string[] = [];
	if (prepared.userScripts.length > 0 && isUserScriptsAvailable()) {
		try { await chrome.userScripts.register(prepared.userScripts); }
		catch (error) { failures.push(failureMessage('userScripts register failed', error)); }
	}
	if (prepared.contentScripts.length > 0) {
		if (!chrome.scripting?.registerContentScripts) failures.push('content-script register unavailable');
		else {
			try { await chrome.scripting.registerContentScripts(prepared.contentScripts); }
			catch (error) { failures.push(failureMessage('content-script register failed', error)); }
		}
	}
	if (failures.length > 0) throw new Error(failures.join('; '));
}

async function performRegisteredScriptSync(): Promise<string> {
	const authority = await readRegistryAuthority();
	const desired = resolveDesiredRegisteredScripts(
		authority.userState,
		authority.saatState,
		authority.userscriptsModuleEnabled,
		authority.moduleValues,
	);
	// Validate and construct the complete next generation before retiring the
	// currently working browser-owned generation.
	const prepared = prepareRegistration(desired);
	await unregisterAllScripts();
	await registerPrepared(prepared);
	return authority.digest;
}

let registryInitialized = false;
let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
let recoveryAttempt = 0;
let requestedGeneration = 0;
let reconciliation: Promise<void> | null = null;

function resetRecoveryTimer(): void {
	if (recoveryTimer) clearTimeout(recoveryTimer);
	recoveryTimer = null;
	recoveryAttempt = 0;
}

async function markRecoveryNeeded(): Promise<void> {
	await chrome.storage.local.set({ [RECOVERY_STORAGE_KEY]: DIRTY_RECEIPT });
}

async function writeRecoveryReceipt(digest: string): Promise<void> {
	const receipt: RegistryReceipt = { version: RECEIPT_VERSION, state: 'clean', digest };
	await chrome.storage.local.set({ [RECOVERY_STORAGE_KEY]: receipt });
}

function isMatchingReceipt(value: unknown, digest: string): boolean {
	if (!value || typeof value !== 'object') return false;
	const receipt = value as Partial<RegistryReceipt>;
	return receipt.version === RECEIPT_VERSION && receipt.state === 'clean' && receipt.digest === digest;
}

function scheduleRecovery(): void {
	if (!registryInitialized || recoveryTimer || recoveryAttempt >= SYNC_RETRY_DELAYS_MS.length) return;
	const delay = SYNC_RETRY_DELAYS_MS[recoveryAttempt++] ?? 4_000;
	recoveryTimer = setTimeout(() => {
		recoveryTimer = null;
		void syncRegisteredScripts().catch((error) => console.warn(LOG_TAG, 'recovery sync failed', error));
	}, delay);
}

async function runRequestedReconciliation(): Promise<void> {
	await markRecoveryNeeded();
	while (true) {
		const targetGeneration = requestedGeneration;
		const digest = await performRegisteredScriptSync();
		if (requestedGeneration !== targetGeneration) continue;
		await writeRecoveryReceipt(digest);
		// A storage event may arrive while the receipt write is pending. If so, the
		// in-memory generation forces another loop; if the worker dies first, the
		// persisted old digest will differ from current authority on next startup.
		if (requestedGeneration === targetGeneration) {
			resetRecoveryTimer();
			return;
		}
		await markRecoveryNeeded();
	}
}

export function syncRegisteredScripts(): Promise<void> {
	requestedGeneration += 1;
	if (reconciliation) return reconciliation;
	reconciliation = runRequestedReconciliation()
		.catch(async (error: unknown) => {
			try { await markRecoveryNeeded(); }
			catch (markerError) { console.warn(LOG_TAG, 'Failed to persist registry recovery marker', markerError); }
			scheduleRecovery();
			throw error;
		})
		.finally(() => { reconciliation = null; });
	return reconciliation;
}

function requestRegisteredScriptSync(reason: string): void {
	void syncRegisteredScripts().catch((error) => console.warn(LOG_TAG, `${reason} sync failed`, error));
}

function recoverPersistentRegistryIfNeeded(): void {
	void (async () => {
		const [authority, receiptResult] = await Promise.all([
			readRegistryAuthority(),
			chrome.storage.local.get(RECOVERY_STORAGE_KEY),
		]);
		if (!registryInitialized) return;
		if (!isMatchingReceipt(receiptResult[RECOVERY_STORAGE_KEY], authority.digest)) {
			requestRegisteredScriptSync('worker-startup-recovery');
		}
	})().catch((error) => {
		if (!registryInitialized) return;
		console.warn(LOG_TAG, 'Failed to inspect registry recovery receipt', error);
		requestRegisteredScriptSync('worker-startup-fail-closed');
	});
}

function includesModuleInstallationChange(changes: Record<string, chrome.storage.StorageChange>): boolean {
	return Object.keys(changes).some((key) => key.startsWith(MODULE_INSTALLATION_STORAGE_PREFIX));
}

export function initUserScriptsRegistry(): () => void {
	if (registryInitialized) return () => {};
	registryInitialized = true;
	const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
		if (area !== 'local') return;
		if (!changes[STORAGE_KEY] && !changes[SAAT_STORAGE_KEY] && !includesModuleInstallationChange(changes)) return;
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
	RECEIPT_VERSION,
	toMatchPatterns,
	validateOwnershipContainers,
	prepareRegistration,
	isMatchingReceipt,
	canonicalize,
};
