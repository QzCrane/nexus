// goal: document-scoped runtime owner for custom-site hotkeys
// inv: lean sites never retain the heavy Content Runtime; full sites preserve the existing lease semantics

import {
	SPECTRA_PROTOCOL_VERSION,
	type SpectraLeanSiteHotkeyBinding,
	type SpectraLeanSiteHotkeyConfigureMessage,
} from '@nexus/contracts/bootstrap';
import type { ResolvedSiteHotkeys } from '../shared/site-hotkey-mode';
import { leanSiteHotkeyBindings, siteHotkeyCapability } from '../shared/site-hotkey-mode';

const LEAN_SITE_HOTKEY_FILE = 'content-site-hotkeys.js';

function documentKey(tabId: number, documentId: string): string {
	return `${tabId}:${documentId}`;
}

export interface LeanSiteHotkeyInjectionPort {
	execute(tabId: number, documentId: string, file: string): Promise<void>;
	configure(
		tabId: number,
		documentId: string,
		message: SpectraLeanSiteHotkeyConfigureMessage,
	): Promise<void>;
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
	async configure(tabId, documentId, message) {
		await chrome.tabs.sendMessage(tabId, message, { documentId });
	},
};

export interface LeanSiteHotkeyInjector {
	configure(
		tabId: number,
		documentId: string,
		bindings: readonly SpectraLeanSiteHotkeyBinding[],
	): Promise<void>;
	disable(tabId: number, documentId: string): Promise<void>;
	forget(tabId: number, documentId?: string): void;
	reset(): void;
	isInjected(tabId: number, documentId: string): boolean;
}

export function createLeanSiteHotkeyInjector(
	port: LeanSiteHotkeyInjectionPort = chromeInjectionPort,
	epoch = crypto.randomUUID(),
): LeanSiteHotkeyInjector {
	const injected = new Set<string>();
	const pending = new Map<string, Promise<void>>();
	const generations = new Map<string, number>();
	let resetGeneration = 0;
	let configurationSequence = 0;

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

	const ensureInjected = (tabId: number, documentId: string): Promise<void> => {
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

	const configureMessage = (
		generation: number,
		bindings: readonly SpectraLeanSiteHotkeyBinding[],
	): SpectraLeanSiteHotkeyConfigureMessage => ({
		protocolVersion: SPECTRA_PROTOCOL_VERSION,
		type: 'spectra.content.site-hotkeys.configure',
		payload: {
			epoch,
			generation,
			bindings: [...bindings],
		},
	});

	const configure = async (
		tabId: number,
		documentId: string,
		bindings: readonly SpectraLeanSiteHotkeyBinding[],
	): Promise<void> => {
		const key = documentKey(tabId, documentId);
		const generation = ++configurationSequence;
		await ensureInjected(tabId, documentId);
		if (!injected.has(key)) return;
		await port.configure(tabId, documentId, configureMessage(generation, bindings));
	};

	const disable = async (tabId: number, documentId: string): Promise<void> => {
		const key = documentKey(tabId, documentId);
		const generation = ++configurationSequence;
		const pendingInjection = pending.get(key);
		if (!injected.has(key) && !pendingInjection) return;
		if (pendingInjection) {
			try {
				await pendingInjection;
			} catch {
				return;
			}
		}
		if (!injected.has(key)) return;
		await port.configure(tabId, documentId, configureMessage(generation, []));
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
		configure,
		disable,
		forget,
		reset() {
			resetGeneration += 1;
			// Keep configurationSequence monotonic for this Worker epoch. A page
			// host may survive a test/reset-style bookkeeping clear and must never
			// receive a lower generation under the same epoch.
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
	configureLean(bindings: readonly SpectraLeanSiteHotkeyBinding[]): Promise<void>;
	disableLean(): Promise<void>;
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

	if (resolved?.mode !== 'lean') {
		// If a lean host is present or still injecting, neutralize it before a full
		// listener can become authoritative. Failure is fail-closed: do not create
		// a competing heavy listener while a lean binding might still be active.
		await port.disableLean();
	}

	if (previousFullCapability && !keepPrevious) {
		port.releaseFull(previousFullCapability);
	}

	if (!resolved) return null;
	if (resolved.mode === 'lean') {
		const bindings = leanSiteHotkeyBindings(resolved);
		if (!bindings) throw new Error('Lean site-hotkey mode has no lean binding projection');
		// Never hide a lean-injection regression by falling back to a permanent
		// heavy Runtime lease. A later HELLO/navigation/settings reconciliation
		// retries because injection/configuration failures are not cached as truth.
		await port.configureLean(bindings);
		return null;
	}

	if (!nextCapability) throw new Error('Full site-hotkey mode has no capability identity');
	if (!keepPrevious) await port.ensureFull(nextCapability);
	return nextCapability;
}

export const siteHotkeyRuntimeTestApi = {
	LEAN_SITE_HOTKEY_FILE,
};
