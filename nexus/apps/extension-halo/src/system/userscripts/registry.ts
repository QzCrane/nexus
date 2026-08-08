// goal: UserScripts dynamic registration using chrome.userScripts API (Chrome 120+)
// eff: Persistent registrations are reconciled only when their authority changes
// NOTE: This runs in background context, requires "userScripts" permission

import {
	isOptionalPackagedModuleStoredEnabled,
	moduleInstallationStorageKey,
} from '../../kernel/core/module-installation-runtime';
import type { UserScript, UserScriptState } from './types';
import type { ScriptType } from './types';

const LOG_TAG = '[HALO:UserScripts:Registry]';
const STORAGE_KEY = 'halo_userscripts';
const SAAT_STORAGE_KEY = 'halo_saat_scripts';
const MODULE_STORAGE_KEY = moduleInstallationStorageKey('userscripts');
const SCRIPT_ID_PREFIX = 'halo-userscript-';

function isUserScriptsAvailable(): boolean {
	return typeof chrome.userScripts !== 'undefined';
}

function normalizePattern(pattern: string): string {
	if (pattern === '*' || pattern === '*/*') return '*://*/*';
	if (pattern.startsWith('*://') || pattern.startsWith('http://') || pattern.startsWith('https://')) {
		return pattern;
	}
	if (pattern.includes('/')) return `*://${pattern}`;
	return `*://${pattern}/*`;
}

function toMatchPatterns(patterns: string[]): string[] {
	const result: string[] = [];
	for (const pattern of patterns) {
		try {
			const normalized = normalizePattern(pattern.trim());
			if (normalized?.includes('://')) result.push(normalized);
		} catch {
			console.warn(LOG_TAG, `Invalid pattern: ${pattern}`);
		}
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
		// biome-ignore lint/style/useTemplate: concatenation required — user code may contain backticks/`${}`
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

async function unregisterAllScripts(): Promise<void> {
	if (isUserScriptsAvailable()) {
		try {
			const registered = await chrome.userScripts.getScripts();
			const haloIds = registered
				.filter((script) => script.id.startsWith(SCRIPT_ID_PREFIX))
				.map((script) => script.id);
			if (haloIds.length > 0) {
				await chrome.userScripts.unregister({ ids: haloIds });
				console.log(LOG_TAG, `Unregistered ${haloIds.length} user scripts`);
			}
		} catch (e) {
			console.warn(LOG_TAG, 'Failed to unregister user scripts:', e);
		}
	}
	try {
		const registeredContent = await chrome.scripting.getRegisteredContentScripts();
		const haloContentIds = registeredContent
			.filter((script) => script.id.startsWith(SCRIPT_ID_PREFIX))
			.map((script) => script.id);
		if (haloContentIds.length > 0) {
			await chrome.scripting.unregisterContentScripts({ ids: haloContentIds });
			console.log(LOG_TAG, `Unregistered ${haloContentIds.length} content scripts`);
		}
	} catch (e) {
		console.warn(LOG_TAG, 'Failed to unregister content scripts:', e);
	}
}

async function registerAllScripts(scripts: UserScript[], globalEnabled: boolean): Promise<void> {
	if (!globalEnabled) return;
	const userScriptsToRegister: chrome.userScripts.RegisteredUserScript[] = [];
	const contentScriptsToRegister: chrome.scripting.RegisteredContentScript[] = [];
	for (const script of scripts) {
		if (!script.enabled) continue;
		try {
			const matches = toMatchPatterns(script.matches);
			const excludeMatches = script.excludeMatches?.length
				? toMatchPatterns(script.excludeMatches)
				: undefined;
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
		} catch (e) {
			console.warn(LOG_TAG, `Failed to prepare ${script.name}:`, e);
		}
	}
	if (userScriptsToRegister.length > 0 && isUserScriptsAvailable()) {
		try { await chrome.userScripts.register(userScriptsToRegister); }
		catch (e) { console.warn(LOG_TAG, 'Failed to register user scripts:', e); }
	}
	if (contentScriptsToRegister.length > 0) {
		try {
			if (chrome.scripting?.registerContentScripts) {
				await chrome.scripting.registerContentScripts(contentScriptsToRegister);
			}
		} catch (e) {
			console.warn(LOG_TAG, 'Failed to register content scripts:', e);
		}
	}
}

async function performRegisteredScriptSync(): Promise<void> {
	const result = await chrome.storage.local.get([
		STORAGE_KEY,
		SAAT_STORAGE_KEY,
		MODULE_STORAGE_KEY,
	]);
	const moduleEnabled = isOptionalPackagedModuleStoredEnabled(
		result[MODULE_STORAGE_KEY],
		Object.hasOwn(result, MODULE_STORAGE_KEY),
	);
	// Registration is browser-persistent. Always retire old registrations first;
	// an explicit module tombstone must remain effective across worker/browser
	// lifetimes and extension update recovery.
	await unregisterAllScripts();
	if (!moduleEnabled) return;
	const userState: UserScriptState = result[STORAGE_KEY] || { scripts: [], globalEnabled: true };
	const saatState: UserScriptState = result[SAAT_STORAGE_KEY] || { scripts: [], globalEnabled: true };
	await registerAllScripts([...userState.scripts, ...saatState.scripts], userState.globalEnabled);
}

let syncLoop: Promise<void> | null = null;
let syncPending = false;

export function syncRegisteredScripts(): Promise<void> {
	syncPending = true;
	if (syncLoop) return syncLoop;
	syncLoop = (async () => {
		do {
			syncPending = false;
			await performRegisteredScriptSync();
		} while (syncPending);
	})().finally(() => {
		syncLoop = null;
		if (syncPending) void syncRegisteredScripts().catch((error) => {
			console.warn(LOG_TAG, 'deferred sync failed', error);
		});
	});
	return syncLoop;
}

let registryInitialized = false;
export function initUserScriptsRegistry(): () => void {
	if (registryInitialized) return () => {};
	registryInitialized = true;
	const listener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
		if (area !== 'local') return;
		if (!changes[STORAGE_KEY] && !changes[SAAT_STORAGE_KEY] && !changes[MODULE_STORAGE_KEY]) return;
		void syncRegisteredScripts().catch((e) => console.warn(LOG_TAG, 'sync failed', e));
	};
	chrome.storage.onChanged.addListener(listener);
	return () => {
		chrome.storage.onChanged.removeListener(listener);
		registryInitialized = false;
	};
}
