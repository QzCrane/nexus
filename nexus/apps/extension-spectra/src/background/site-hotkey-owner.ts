// goal: sole Background owner of exact-document custom-site hotkey runtime state
// inv: document reconciliations serialize; forgotten generations cannot publish later side effects

import {
	SPECTRA_PROTOCOL_VERSION,
	isSpectraDefaultHotkeyKeyCombo,
	type SpectraLeanSiteHotkeyBinding,
} from '@nexus/contracts';
import {
	isLeanSiteHotkeyBinding,
	siteHotkeyCapability,
	type ResolvedSiteHotkeys,
} from '../shared/site-hotkey-mode';
import { reconcileSiteHotkeyTransition } from './site-hotkey-transition';

const LEAN_HOST_FILE = 'content-site-hotkeys.js';
const NO_RECEIVER_FRAGMENT = 'Receiving end does not exist';

function documentKey(tabId: number, documentId: string): string {
	return `${tabId}:${documentId}`;
}

export interface FullSiteHotkeyRuntimePort {
	ensure(capability: string): Promise<void>;
	release(capability: string): void;
}

export type LeanHostDelivery = 'delivered' | 'absent';

interface LeanConfigureAck {
	accepted: true;
	epoch: string;
	generation: number;
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
	): Promise<LeanHostDelivery>;
}

function isMissingLeanReceiver(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes(NO_RECEIVER_FRAGMENT);
}

function isConfigureAck(
	value: unknown,
	epoch: string,
	generation: number,
): value is LeanConfigureAck {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Partial<LeanConfigureAck>;
	return candidate.accepted === true
		&& candidate.epoch === epoch
		&& candidate.generation === generation;
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
		try {
			const response: unknown = await chrome.tabs.sendMessage(tabId, message, { documentId });
			if (!isConfigureAck(response, message.payload.epoch, message.payload.generation)) {
				throw new Error('Lean site-hotkey host returned an invalid configuration acknowledgement');
			}
			return 'delivered';
		} catch (error) {
			if (isMissingLeanReceiver(error)) return 'absent';
			throw error;
		}
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

class RetiredSiteHotkeyDocumentError extends Error {
	constructor() {
		super('Site-hotkey document lifecycle retired');
		this.name = 'RetiredSiteHotkeyDocumentError';
	}
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

	private assertLifecycle(key: string, expected: number): void {
		if (this.documentGeneration(key) !== expected) throw new RetiredSiteHotkeyDocumentError();
	}

	private cleanupLifecycleKey(key: string): void {
		if (this.injectionPromises.has(key)
			|| this.transitionTails.has(key)
			|| this.injectedDocuments.has(key)
			|| this.fullCapabilities.has(key)) return;
		this.lifecycleGeneration.delete(key);
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

	private async injectLeanHost(
		tabId: number,
		documentId: string,
		lifecycle: number,
	): Promise<void> {
		const key = documentKey(tabId, documentId);
		this.assertLifecycle(key, lifecycle);
		if (this.injectedDocuments.has(key)) return;
		const pending = this.injectionPromises.get(key);
		if (pending) {
			await pending;
			this.assertLifecycle(key, lifecycle);
			return;
		}
		const operation = this.hostPort.inject(tabId, documentId)
			.then(() => {
				this.assertLifecycle(key, lifecycle);
				this.injectedDocuments.add(key);
			})
			.finally(() => {
				if (this.injectionPromises.get(key) === operation) this.injectionPromises.delete(key);
				this.cleanupLifecycleKey(key);
			});
		this.injectionPromises.set(key, operation);
		await operation;
	}

	private configure(
		tabId: number,
		documentId: string,
		bindings: SpectraLeanSiteHotkeyBinding[],
	): Promise<LeanHostDelivery> {
		return this.hostPort.configure(tabId, documentId, this.nextConfiguration(bindings));
	}

	private serialize(key: string, operation: () => Promise<void>): Promise<void> {
		const previous = this.transitionTails.get(key) ?? Promise.resolve();
		const next = previous.catch(() => undefined).then(operation);
		const tracked = next.finally(() => {
			if (this.transitionTails.get(key) === tracked) this.transitionTails.delete(key);
			this.cleanupLifecycleKey(key);
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
		if (!this.lifecycleGeneration.has(key)) this.lifecycleGeneration.set(key, 0);
		return this.serialize(key, async () => {
			const lifecycle = this.documentGeneration(key);
			const fullCapability = resolved?.mode === 'full'
				? siteHotkeyCapability(resolved) ?? undefined
				: undefined;
			const leanBindings = projectLeanBindings(resolved);
			try {
				await reconcileSiteHotkeyTransition({
					mode: resolved?.mode ?? 'none',
					previousFullCapability: this.fullCapabilities.get(key),
					fullCapability,
				}, {
					barrier: async () => {
						// No receiver is already empty. Any other transport/protocol error
						// remains fail-closed. A surviving old-worker host returns an ACK.
						await this.configure(tabId, documentId, []);
						this.assertLifecycle(key, lifecycle);
					},
					configureLean: async () => {
						await this.injectLeanHost(tabId, documentId, lifecycle);
						this.assertLifecycle(key, lifecycle);
						const delivery = await this.configure(tabId, documentId, leanBindings);
						this.assertLifecycle(key, lifecycle);
						if (delivery !== 'delivered') {
							throw new Error('Injected lean site-hotkey host did not accept configuration');
						}
					},
					ensureFull: async (capability) => {
						this.assertLifecycle(key, lifecycle);
						await fullRuntime.ensure(capability);
						if (this.documentGeneration(key) !== lifecycle) {
							fullRuntime.release(capability);
							throw new RetiredSiteHotkeyDocumentError();
						}
						this.fullCapabilities.set(key, capability);
					},
					releaseFull: (capability) => {
						fullRuntime.release(capability);
						if (this.fullCapabilities.get(key) === capability) this.fullCapabilities.delete(key);
					},
				});
				this.assertLifecycle(key, lifecycle);
				if (resolved?.mode !== 'full') this.fullCapabilities.delete(key);
			} catch (error) {
				if (error instanceof RetiredSiteHotkeyDocumentError) return;
				throw error;
			}
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
			this.fullCapabilities.delete(key);
			// Never delete an in-flight promise/tail here. The retired operation must
			// observe the new lifecycle token before it can publish another side effect.
			this.cleanupLifecycleKey(key);
		}
	}

	reset(): void {
		const keys = new Set<string>([
			...this.injectedDocuments,
			...this.injectionPromises.keys(),
			...this.transitionTails.keys(),
			...this.fullCapabilities.keys(),
			...this.lifecycleGeneration.keys(),
		]);
		for (const key of keys) {
			this.lifecycleGeneration.set(key, this.documentGeneration(key) + 1);
			this.injectedDocuments.delete(key);
			this.fullCapabilities.delete(key);
			this.cleanupLifecycleKey(key);
		}
	}
}

export const siteHotkeyDocumentOwner = new SiteHotkeyDocumentOwner();
export const siteHotkeyOwnerTestApi = {
	LEAN_HOST_FILE,
	NO_RECEIVER_FRAGMENT,
	projectLeanBindings,
};
