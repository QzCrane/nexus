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
import { isUserScriptsCapabilityAvailable } from './capability';

const LOG_TAG = '[HALO:UserScripts:Registry]';
const STORAGE_KEY = 'halo_userscripts';
const SAAT_STORAGE_KEY = 'halo_saat_scripts';
const USERSCRIPTS_MODULE_KEY = moduleInstallationStorageKey('userscripts');
const SAAT_DESCRIPTOR_VERSION_KEY = 'halo_userscripts_saat_descriptor_version_v1';
const RECOVERY_STORAGE_KEY = 'halo_userscripts_registry_dirty_v1';
const SCRIPT_ID_PREFIX = 'halo-userscript-';
const SYNC_RETRY_DELAYS_MS = [250, 1_000, 4_000] as const;
const RECEIPT_VERSION = 2;
const DIRTY_RECEIPT = Object.freeze({ version: RECEIPT_VERSION, state: 'dirty' as const });

type RegistryReceipt =
	| { version: typeof RECEIPT_VERSION; state: 'dirty' }
	| { version: typeof RECEIPT_VERSION; state: 'blocked' | 'clean'; digest: string };

interface PreparedRegistration {
	userScripts: chrome.userScripts.RegisteredUserScript[];
	contentScripts: chrome.scripting.RegisteredContentScript[];
}
interface RegistryAuthority {
	userScriptsAvailable: boolean;
	prepared: PreparedRegistration;
	digest: string;
}
interface ReconciliationResult {
	digest: string;
	receiptState: 'blocked' | 'clean';
}
interface PersistentRegistryReceiptStatus {
	satisfied: boolean;
	userScriptsAvailable: boolean;
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

function prepareRegistration(scripts: readonly UserScriptsSnapshotScript[]): PreparedRegistration {
	const userScripts: chrome.userScripts.RegisteredUserScript[] = [];
	const contentScripts: chrome.scripting.RegisteredContentScript[] = [];
	const registrationIds = new Set<string>();
	for (const script of scripts) {
		if (!script.enabled) continue;
		const matches = toMatchPatterns(script.matches);
		const excludeMatches = script.excludeMatches?.length ? script.excludeMatches.map(normalizePattern) : undefined;
		const id = `${SCRIPT_ID_PREFIX}${script.id}`;
		if (registrationIds.has(id)) throw new Error(`Duplicate runtime script id: ${script.id}`);
		registrationIds.add(id);
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
				world,
			});
		}
	}
	return { userScripts, contentScripts };
}

async function readRegistryAuthority(): Promise<RegistryAuthority> {
	const [stateResult, userScriptsAvailable] = await Promise.all([
		chrome.storage.local.get([
			STORAGE_KEY,
			SAAT_STORAGE_KEY,
			USERSCRIPTS_MODULE_KEY,
			SAAT_DESCRIPTOR_VERSION_KEY,
		]),
		isUserScriptsCapabilityAvailable(),
	]);
	const extensionVersion = chrome.runtime.getManifest().version;
	const descriptorVersion = stateResult[SAAT_DESCRIPTOR_VERSION_KEY];
	if (descriptorVersion !== extensionVersion) {
		throw new Error(`SaaT descriptor projection is not synchronized for extension ${extensionVersion}`);
	}
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
	const desired = resolveDesiredRegisteredScripts(
		userState,
		saatState,
		userscriptsModuleEnabled,
		moduleValues,
	);
	// The receipt fingerprints the exact browser generation, not the whole UI
	// persistence envelope. Telemetry, timestamps, toolbar configuration and
	// metadata changes must never tear down a physically unchanged generation.
	const prepared = prepareRegistration(desired);
	const digest = await digestAuthority({
		extensionVersion,
		saatDescriptorVersion: descriptorVersion,
		userScriptsAvailable,
		prepared,
	});
	return {
		userScriptsAvailable,
		prepared,
		digest,
	};
}

async function reconcilePrepared(
	prepared: PreparedRegistration,
	userScriptsAvailable: boolean,
): Promise<void> {
	const failures: string[] = [];
	if (userScriptsAvailable) {
		try {
			const current = (await chrome.userScripts.getScripts())
				.filter((script) => script.id.startsWith(SCRIPT_ID_PREFIX));
			const currentIds = new Set(current.map((script) => script.id));
			const desiredIds = new Set(prepared.userScripts.map((script) => script.id));
			const additions = prepared.userScripts.filter((script) => !currentIds.has(script.id));
			const updates = prepared.userScripts.filter((script) => currentIds.has(script.id));
			if (additions.length > 0) await chrome.userScripts.register(additions);
			if (updates.length > 0) await chrome.userScripts.update(updates);
			const obsolete = current.filter((script) => !desiredIds.has(script.id)).map((script) => script.id);
			if (obsolete.length > 0) await chrome.userScripts.unregister({ ids: obsolete });
		} catch (error) { failures.push(failureMessage('userScripts reconcile failed', error)); }
	}
	try {
		const current = (await chrome.scripting.getRegisteredContentScripts())
			.filter((script) => script.id.startsWith(SCRIPT_ID_PREFIX));
		const currentIds = new Set(current.map((script) => script.id));
		const desiredIds = new Set(prepared.contentScripts.map((script) => script.id));
		const additions = prepared.contentScripts.filter((script) => !currentIds.has(script.id));
		const updates = prepared.contentScripts.filter((script) => currentIds.has(script.id));
		if (additions.length > 0) await chrome.scripting.registerContentScripts(additions);
		if (updates.length > 0) await chrome.scripting.updateContentScripts(updates);
		const obsolete = current.filter((script) => !desiredIds.has(script.id)).map((script) => script.id);
		if (obsolete.length > 0) await chrome.scripting.unregisterContentScripts({ ids: obsolete });
	} catch (error) {
		failures.push(failureMessage('content-script reconcile failed', error));
	}
	if (failures.length > 0) throw new Error(failures.join('; '));
}

async function performRegisteredScriptSync(): Promise<ReconciliationResult> {
	const authority = await readRegistryAuthority();
	// Preflight materializes the whole generation. Reconciliation adds/updates
	// desired registrations before deleting obsolete ones, so a transient API
	// failure cannot erase the previous working generation.
	await reconcilePrepared(authority.prepared, authority.userScriptsAvailable);
	return {
		digest: authority.digest,
		receiptState: authority.userScriptsAvailable ? 'clean' : 'blocked',
	};
}

let registryInitialized = false;
let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
let recoveryAttempt = 0;
let requestedGeneration = 0;
let reconciliation: Promise<void> | null = null;
let ensureRequestedGeneration = 0;
let ensureSynchronized: Promise<void> | null = null;
let ensureRuntimeReady: Promise<void> | null = null;

function resetRecoveryTimer(): void {
	if (recoveryTimer) clearTimeout(recoveryTimer);
	recoveryTimer = null;
	recoveryAttempt = 0;
}

async function markRecoveryNeeded(): Promise<void> {
	await chrome.storage.local.set({ [RECOVERY_STORAGE_KEY]: DIRTY_RECEIPT });
}

export async function markSaaTDescriptorProjectionCurrent(): Promise<void> {
	await chrome.storage.local.set({
		[SAAT_DESCRIPTOR_VERSION_KEY]: chrome.runtime.getManifest().version,
	});
}

async function writeRecoveryReceipt(
	digest: string,
	state: 'blocked' | 'clean',
): Promise<void> {
	const receipt: RegistryReceipt = { version: RECEIPT_VERSION, state, digest };
	await chrome.storage.local.set({ [RECOVERY_STORAGE_KEY]: receipt });
}

function isSatisfiedReceipt(
	value: unknown,
	digest: string,
	userScriptsAvailable: boolean,
): boolean {
	if (!value || typeof value !== 'object') return false;
	const receipt = value as Partial<RegistryReceipt> & { digest?: unknown };
	if (receipt.version !== RECEIPT_VERSION || receipt.digest !== digest) return false;
	return userScriptsAvailable ? receipt.state === 'clean' : receipt.state === 'blocked';
}

async function readPersistentRegistryReceiptStatus(): Promise<PersistentRegistryReceiptStatus> {
	const [authority, receiptResult] = await Promise.all([
		readRegistryAuthority(),
		chrome.storage.local.get(RECOVERY_STORAGE_KEY),
	]);
	return {
		satisfied: isSatisfiedReceipt(
			receiptResult[RECOVERY_STORAGE_KEY],
			authority.digest,
			authority.userScriptsAvailable,
		),
		userScriptsAvailable: authority.userScriptsAvailable,
	};
}

async function hasSatisfiedPersistentRegistryReceipt(): Promise<boolean> {
	return (await readPersistentRegistryReceiptStatus()).satisfied;
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
		const result = await performRegisteredScriptSync();
		if (requestedGeneration !== targetGeneration) continue;
		await writeRecoveryReceipt(result.digest, result.receiptState);
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

export function ensureRegisteredScriptsSynchronized(): Promise<void> {
	ensureRequestedGeneration += 1;
	if (ensureSynchronized) return ensureSynchronized;
	ensureSynchronized = (async () => {
		for (let attempt = 0; attempt < 3; attempt += 1) {
			const targetGeneration = ensureRequestedGeneration;
			if (reconciliation) await reconciliation;
			let satisfied = await hasSatisfiedPersistentRegistryReceipt();
			if (!satisfied) {
				await syncRegisteredScripts();
				satisfied = await hasSatisfiedPersistentRegistryReceipt();
			}
			if (satisfied && ensureRequestedGeneration === targetGeneration) return;
		}
		throw new Error('UserScripts registry authority changed faster than the receipt barrier could converge');
	})().finally(() => { ensureSynchronized = null; });
	return ensureSynchronized;
}

export function ensureUserScriptsRuntimeReady(): Promise<void> {
	if (ensureRuntimeReady) return ensureRuntimeReady;
	ensureRuntimeReady = (async () => {
		for (let attempt = 0; attempt < 2; attempt += 1) {
			await ensureRegisteredScriptsSynchronized();
			const status = await readPersistentRegistryReceiptStatus();
			if (!status.userScriptsAvailable) {
				throw new Error('Chrome User Scripts runtime capability is unavailable');
			}
			if (status.satisfied) return;
		}
		throw new Error('UserScripts browser registry did not converge to a clean available receipt');
	})().finally(() => { ensureRuntimeReady = null; });
	return ensureRuntimeReady;
}

function requestRegisteredScriptSync(reason: string): void {
	void syncRegisteredScripts().catch((error) => console.warn(LOG_TAG, `${reason} sync failed`, error));
}

function requestRegisteredScriptEnsure(reason: string): void {
	void ensureRegisteredScriptsSynchronized().catch((error) => console.warn(LOG_TAG, `${reason} receipt check failed`, error));
}

function recoverPersistentRegistryIfNeeded(): void {
	void hasSatisfiedPersistentRegistryReceipt().then((satisfied) => {
		if (!registryInitialized || satisfied) return;
		requestRegisteredScriptSync('worker-startup-recovery');
	}).catch((error) => {
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
		if (
			!changes[STORAGE_KEY]
			&& !changes[SAAT_STORAGE_KEY]
			&& !changes[SAAT_DESCRIPTOR_VERSION_KEY]
			&& !includesModuleInstallationChange(changes)
		) return;
		requestRegisteredScriptEnsure('storage-change');
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
	SAAT_DESCRIPTOR_VERSION_KEY,
	RECOVERY_STORAGE_KEY,
	SYNC_RETRY_DELAYS_MS,
	RECEIPT_VERSION,
	toMatchPatterns,
	validateOwnershipContainers,
	prepareRegistration,
	isSatisfiedReceipt,
	canonicalize,
};
