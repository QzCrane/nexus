// goal: document-scoped runtime owner for custom-site hotkeys
// inv: lean sites never retain the heavy Content Runtime; full sites preserve the existing lease semantics

import type { ResolvedSiteHotkeys } from '../shared/site-hotkey-mode';
import { siteHotkeyCapability } from '../shared/site-hotkey-mode';

const LEAN_SITE_HOTKEY_FILE = 'content-site-hotkeys.js';

function documentKey(tabId: number, documentId: string): string {
	return `${tabId}:${documentId}`;
}

export interface LeanSiteHotkeyInjectionPort {
	execute(tabId: number, documentId: string, file: string): Promise<void>;
}

const chromeInjectionPort: LeanSiteHotkeyInjectionPort = {
	async execute(tabId, documentId, file) {
		await chrome.scripting.executeScript({
			target: { tabId, documentIds: [documentId] },
			files: [file],
			world: 'ISOLATED',
			injectImmediately: true,
		});
	},
};

export interface LeanSiteHotkeyInjector {
	ensure(tabId: number, documentId: string): Promise<void>;
	forget(tabId: number, documentId?: string): void;
	reset(): void;
	isInjected(tabId: number, documentId: string): boolean;
}

export function createLeanSiteHotkeyInjector(
	port: LeanSiteHotkeyInjectionPort = chromeInjectionPort,
): LeanSiteHotkeyInjector {
	const injected = new Set<string>();
	const pending = new Map<string, Promise<void>>();
	const generations = new Map<string, number>();
	let resetGeneration = 0;

	const generationOf = (key: string): number => generations.get(key) ?? 0;
	const cleanupGeneration = (key: string, generation: number): void => {
		if (
			generationOf(key) === generation
			&& !pending.has(key)
			&& !injected.has(key)
		) generations.delete(key);
	};
	const retireKey = (key: string): void => {
		const operation = pending.get(key);
		const generation = generationOf(key) + 1;
		injected.delete(key);
		pending.delete(key);
		if (!operation) {
			generations.delete(key);
			return;
		}
		generations.set(key, generation);
		void operation.then(
			() => cleanupGeneration(key, generation),
			() => cleanupGeneration(key, generation),
		);
	};

	const ensure = (tabId: number, documentId: string): Promise<void> => {
		const key = documentKey(tabId, documentId);
		if (injected.has(key)) return Promise.resolve();
		const existing = pending.get(key);
		if (existing) return existing;
		const keyGeneration = generationOf(key);
		const globalGeneration = resetGeneration;

		const operation = port.execute(tabId, documentId, LEAN_SITE_HOTKEY_FILE)
			.then(() => {
				if (
					resetGeneration === globalGeneration
					&& generationOf(key) === keyGeneration
				) injected.add(key);
			})
			.finally(() => {
				if (pending.get(key) === operation) pending.delete(key);
				cleanupGeneration(key, keyGeneration);
			});
		pending.set(key, operation);
		return operation;
	};

	const forget = (tabId: number, documentId?: string): void => {
		if (documentId !== undefined) {
			retireKey(documentKey(tabId, documentId));
			return;
		}
		const prefix = `${tabId}:`;
		const keys = new Set<string>();
		for (const key of injected) if (key.startsWith(prefix)) keys.add(key);
		for (const key of pending.keys()) if (key.startsWith(prefix)) keys.add(key);
		for (const key of generations.keys()) if (key.startsWith(prefix)) keys.add(key);
		for (const key of keys) retireKey(key);
	};

	return {
		ensure,
		forget,
		reset() {
			resetGeneration += 1;
			injected.clear();
			pending.clear();
			generations.clear();
		},
		isInjected(tabId, documentId) {
			return injected.has(documentKey(tabId, documentId));
		},
	};
}

export const leanSiteHotkeyInjector = createLeanSiteHotkeyInjector();

export interface SiteHotkeyRuntimePort {
	ensureFull(capability: string): Promise<void>;
	releaseFull(capability: string): void;
	ensureLean(): Promise<void>;
}

// post: return value is the only full-runtime hotkey capability that should
// remain recorded for this document. `null` means zero heavy hotkey lease.
export async function reconcileSiteHotkeyRuntime(
	previousFullCapability: string | undefined,
	resolved: ResolvedSiteHotkeys | null,
	port: SiteHotkeyRuntimePort,
): Promise<string | null> {
	const nextCapability = siteHotkeyCapability(resolved);
	const keepPrevious = resolved?.mode === 'full'
		&& previousFullCapability !== undefined
		&& previousFullCapability === nextCapability;

	if (previousFullCapability && !keepPrevious) {
		port.releaseFull(previousFullCapability);
	}

	if (!resolved) return null;
	if (resolved.mode === 'lean') {
		// Never hide a lean-injection regression by falling back to a permanent
		// heavy Runtime lease. The caller may retry at HELLO/navigation/settings
		// reconciliation because failed injector promises are not cached.
		await port.ensureLean();
		return null;
	}

	if (!nextCapability) throw new Error('Full site-hotkey mode has no capability identity');
	if (!keepPrevious) await port.ensureFull(nextCapability);
	return nextCapability;
}

export const siteHotkeyRuntimeTestApi = {
	LEAN_SITE_HOTKEY_FILE,
};
