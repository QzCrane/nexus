// goal: sole Background owner of exact-document custom-site hotkey runtime state
// inv: document reconciliations are serialized; lean and full ownership never transition through an unversioned broadcast

import {
	SPECTRA_PROTOCOL_VERSION,
	type SpectraLeanSiteHotkeyBinding,
	isSpectraDefaultHotkeyKeyCombo,
} from '@nexus/contracts';
import {
	isLeanSiteHotkeyBinding,
	siteHotkeyCapability,
	type ResolvedSiteHotkeys,
} from '../shared/site-hotkey-mode';
import { reconcileSiteHotkeyTransition } from './site-hotkey-transition';

const LEAN_HOST_FILE = 'content-site-hotkeys.js';

function documentKey(tabId: number, documentId: string): string {
	return `${tabId}:${documentId}`;
}

export interface FullSiteHotkeyRuntimePort {
	ensure(capability: string): Promise<void>;
	release(capability: string): void;
}

export interface SiteHotkeyHostPort {
	inject(tabId: number, documentId: string): Promise<void>;
	configure(
		tabId: number,
		documentId: string,
		message: {
			protocolVersion: typeof SPECTRA_PROTOCOL_VERSION;
			type: 'spectra.content.site-hotkeys.configure';
			payload: {
				epoch: string;
				generation: number;
				bindings: SpectraLeanSiteHotkeyBinding[];
			};
		},
	): Promise<void>;
}

const chromeHostPort: SiteHotkeyHostPort = {
	async inject(tabId, documentId) {
		await chrome.scripting.executeScript({
			target: { tabId, documentIds: [documentId] },
			files: [LEAN_HOST_FILE],
			world: 'ISOLATED',
			injectImmediately: true,
		});
	},
	async configure(tabId, documentId, message) {
		await chrome.tabs.sendMessage(tabId, message, { documentId });
	},
};

function projectLeanBindings(resolved: ResolvedSiteHotkeys | null): SpectraLeanSiteHotkeyBinding[] {
	if (resolved?.mode !== 'lean') return [];
	return resolved.site.bindings
		.filter(isLeanSiteHotkeyBinding)
		.filter((binding) => !isSpectraDefaultHotkeyKeyCombo(binding.key))
		.map((binding) => ({
			code: binding.key.code,
			modifiers: { ...binding.key.modifiers },
			action: binding.action as SpectraLeanSiteHotkeyBinding['action'],
		}));
}

export class SiteHotkeyDocumentOwner {
	private readonly epoch = crypto.randomUUID();
	private generation = 0;
	private readonly injectedDocuments = new Set<string>();
	private readonly injectionPromises = new Map<string, Promise<void>>();
	private readonly lifecycleGeneration = new Map<string, number>();
	private readonly transitionTails = new Map<string, Promise<void>>();
	private readonly fullCapabilities = new Map<string, string>();

	constructor(private readonly hostPort: SiteHotkeyHostPort = chromeHostPort) {}

	private documentGeneration(key: string): number {
		return this.lifecycleGeneration.get(key) ?? 0;
	}

	private nextConfiguration(bindings: SpectraLeanSiteHotkeyBinding[]) {
		this.generation += 1;
		return {
			protocolVersion: SPECTRA_PROTOCOL_VERSION,
			type: 'spectra.content.site-hotkeys.configure' as const,
			payload: {
				epoch: this.epoch,
				generation: this.generation,
				bindings,
			},
		};
	}

	private async injectLeanHost(tabId: number, documentId: string): Promise<void> {
		const key = documentKey(tabId, documentId);
		if (this.injectedDocuments.has(key)) return;
		const pending = this.injectionPromises.get(key);
		if (pending) return pending;
		const lifecycle = this.documentGeneration(key);
		const operation = this.hostPort.inject(tabId, documentId)
			.then(() => {
				if (this.documentGeneration(key) === lifecycle) this.injectedDocuments.add(key);
			})
			.finally(() => {
				if (this.injectionPromises.get(key) === operation) this.injectionPromises.delete(key);
			});
		this.injectionPromises.set(key, operation);
		return operation;
	}

	private configure(
		tabId: number,
		documentId: string,
		bindings: SpectraLeanSiteHotkeyBinding[],
	): Promise<void> {
		return this.hostPort.configure(tabId, documentId, this.nextConfiguration(bindings));
	}

	private serialize(key: string, operation: () => Promise<void>): Promise<void> {
		const previous = this.transitionTails.get(key) ?? Promise.resolve();
		const next = previous.catch(() => undefined).then(operation);
		const tracked = next.finally(() => {
			if (this.transitionTails.get(key) === tracked) this.transitionTails.delete(key);
		});
		this.transitionTails.set(key, tracked);
		return tracked;
	}

	reconcile(
		tabId: number,
		documentId: string,
		resolved: ResolvedSiteHotkeys | null,
		fullRuntime: FullSiteHotkeyRuntimePort,
	): Promise<void> {
		const key = documentKey(tabId, documentId);
		return this.serialize(key, async () => {
			const fullCapability = resolved?.mode === 'full'
				? siteHotkeyCapability(resolved) ?? undefined
				: undefined;
			const leanBindings = projectLeanBindings(resolved);
			await reconcileSiteHotkeyTransition({
				mode: resolved?.mode ?? 'none',
				previousFullCapability: this.fullCapabilities.get(key),
				fullCapability,
			}, {
				// Always send an exact empty generation. A restarted worker may not
				// know whether the surviving document already contains an older host.
				barrier: () => this.configure(tabId, documentId, []),
				configureLean: async () => {
					await this.injectLeanHost(tabId, documentId);
					await this.configure(tabId, documentId, leanBindings);
				},
				ensureFull: async (capability) => {
					await fullRuntime.ensure(capability);
					this.fullCapabilities.set(key, capability);
				},
				releaseFull: (capability) => {
					fullRuntime.release(capability);
					if (this.fullCapabilities.get(key) === capability) this.fullCapabilities.delete(key);
				},
			});
			if (resolved?.mode !== 'full') this.fullCapabilities.delete(key);
		});
	}

	forget(tabId: number, documentId?: string): void {
		const prefix = `${tabId}:`;
		const keys = new Set<string>();
		for (const key of this.injectedDocuments) if (key.startsWith(prefix)) keys.add(key);
		for (const key of this.injectionPromises.keys()) if (key.startsWith(prefix)) keys.add(key);
		for (const key of this.transitionTails.keys()) if (key.startsWith(prefix)) keys.add(key);
		for (const key of this.fullCapabilities.keys()) if (key.startsWith(prefix)) keys.add(key);
		for (const key of this.lifecycleGeneration.keys()) if (key.startsWith(prefix)) keys.add(key);
		if (documentId !== undefined) keys.add(documentKey(tabId, documentId));
		for (const key of keys) {
			if (documentId !== undefined && key !== documentKey(tabId, documentId)) continue;
			this.lifecycleGeneration.set(key, this.documentGeneration(key) + 1);
			this.injectedDocuments.delete(key);
			this.injectionPromises.delete(key);
			this.transitionTails.delete(key);
			this.fullCapabilities.delete(key);
		}
	}

	reset(): void {
		this.injectedDocuments.clear();
		this.injectionPromises.clear();
		this.transitionTails.clear();
		this.fullCapabilities.clear();
		this.lifecycleGeneration.clear();
	}
}

export const siteHotkeyDocumentOwner = new SiteHotkeyDocumentOwner();
export const siteHotkeyOwnerTestApi = { LEAN_HOST_FILE, projectLeanBindings };
