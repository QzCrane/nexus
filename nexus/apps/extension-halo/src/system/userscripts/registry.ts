// goal: UserScripts dynamic registration using chrome.userScripts API (Chrome 120+)
// eff: Persistent registrations are reconciled only when their authority changes
// NOTE: This runs in background context, requires "userScripts" permission

import type { ScriptType } from './types';
import {
	parseUserScriptsStorageValue,
	type UserScriptsSnapshotScript,
} from './storage-authority';

const LOG_TAG = '[HALO:UserScripts:Registry]';
const STORAGE_KEY = 'halo_userscripts';
const SAAT_STORAGE_KEY = 'halo_saat_scripts';
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

function toMatchPatterns(patterns: readonly string[]): string[] {
	const result: string[] = [];
	for (const pattern of patterns) {
		try {
			const normalized = normalizePattern(pattern.trim());
			if (normalized.includes('://')) result.push(normalized);
		} catch {
			console.warn(LOG_TAG, `Invalid pattern: ${pattern}`);
		}
	}
	if (result.length === 0) throw new Error('No valid match patterns');
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

// Build wrappers by concatenation. User code may contain template literals and
// must never be interpolated into a template literal owned by the extension.
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
		const registered = await chrome.userScripts.getScripts();
		const haloIds = registered
			.filter((script) => script.id.startsWith(SCRIPT_ID_PREFIX))
			.map((script) => script.id);

		if (haloIds.length > 0) {
			await chrome.userScripts.unregister({ ids: haloIds });
			console.log(LOG_TAG, `Unregistered ${haloIds.length} user scripts`);
		}
	}

	const registeredContent = await chrome.scripting.getRegisteredContentScripts();
	const haloContentIds = registeredContent
		.filter((script) => script.id.startsWith(SCRIPT_ID_PREFIX))
		.map((script) => script.id);

	if (haloContentIds.length > 0) {
		await chrome.scripting.unregisterContentScripts({ ids: haloContentIds });
		console.log(LOG_TAG, `Unregistered ${haloContentIds.length} content scripts`);
	}
}

async function registerAllScripts(
	scripts: readonly UserScriptsSnapshotScript[],
	globalEnabled: boolean,
): Promise<void> {
	if (!globalEnabled) {
		console.log(LOG_TAG, 'Global disabled, skipping registration');
		return;
	}

	const userScriptsToRegister: chrome.userScripts.RegisteredUserScript[] = [];
	const contentScriptsToRegister: chrome.scripting.RegisteredContentScript[] = [];

	for (const script of scripts) {
		if (!script.enabled) continue;

		const matches = toMatchPatterns(script.matches);
		const excludeMatches = script.excludeMatches?.length
			? toMatchPatterns(script.excludeMatches)
			: undefined;
		const fullId = `${SCRIPT_ID_PREFIX}${script.id}`;
		const world = script.world || 'USER_SCRIPT';

		if (world === 'ISOLATED') {
			if (!script.filePath) {
				throw new Error(`ISOLATED script ${script.id} has no packaged file path`);
			}

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
			const wrappedCode = wrapForMainWorld(script.code, script.name, script.type);
			userScriptsToRegister.push({
				id: fullId,
				matches,
				excludeMatches,
				js: [{ code: wrappedCode }],
				runAt: toRunAt(script.runAt),
				allFrames: false,
				world: 'USER_SCRIPT',
			});
		}
	}

	if (userScriptsToRegister.length > 0 && isUserScriptsAvailable()) {
		await chrome.userScripts.register(userScriptsToRegister);
		console.log(LOG_TAG, `Registered ${userScriptsToRegister.length} user scripts`);
	}

	if (contentScriptsToRegister.length > 0) {
		if (!chrome.scripting?.registerContentScripts) {
			throw new Error('chrome.scripting.registerContentScripts is unavailable');
		}
		await chrome.scripting.registerContentScripts(contentScriptsToRegister);
		console.log(LOG_TAG, `Registered ${contentScriptsToRegister.length} content scripts`);
	}
}

async function performRegisteredScriptSync(): Promise<void> {
	const result = await chrome.storage.local.get([STORAGE_KEY, SAAT_STORAGE_KEY]);
	const userState = parseUserScriptsStorageValue(result[STORAGE_KEY]);
	const saatState = parseUserScriptsStorageValue(result[SAAT_STORAGE_KEY]);

	// Background and SidePanel share the same persistence contract. Corrupt raw
	// storage can never be registered while the UI reports the authority failed.
	if (userState.failed || saatState.failed) {
		await unregisterAllScripts();
		return;
	}
	const allScripts = [...userState.scripts, ...saatState.scripts];

	// Both generations are fully parsed before destructive teardown.
	await unregisterAllScripts();
	await registerAllScripts(allScripts, userState.globalEnabled);
}

// Multiple storage writes/manual requests/install reconciliation can converge in
// one moment. Serialize registration and keep at most one trailing sync instead
// of racing unregister/register operations against each other.
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

// Registered user/content scripts are browser-persistent. Do not unregister and
// rebuild them on every MV3 service-worker wake. This function only establishes
// the authority-change listener; onInstalled performs update/install recovery.
let registryInitialized = false;
export function initUserScriptsRegistry(): () => void {
	if (registryInitialized) return () => {};
	registryInitialized = true;

	const listener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
		if (area !== 'local') return;
		if (!changes[STORAGE_KEY] && !changes[SAAT_STORAGE_KEY]) return;
		void syncRegisteredScripts().catch((error) => console.warn(LOG_TAG, 'sync failed', error));
	};
	chrome.storage.onChanged.addListener(listener);

	return () => {
		chrome.storage.onChanged.removeListener(listener);
		registryInitialized = false;
	};
}
