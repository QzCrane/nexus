// goal: manages tab-level session configs that persist across page refresh but not across tabs
// note: uses chrome.storage.session with tabId-prefixed keys

import { AudioConfig, DEFAULT_AUDIO_CONFIG } from '../messages/protocol.js';
import { resolveAudioVolume, type TabSessionIdentity } from '@nexus/contracts';
import { createKeyedSerializedQueue } from './serialized-queue.js';

const TAB_SESSION_PREFIX = 'tab_session_';
const STORAGE_WRITE_DEBOUNCE_MS = 250;
const MAX_WRITE_RETRIES = 5;

interface StoredTabSession {
	identity: TabSessionIdentity;
	config: AudioConfig;
	updatedAt: number;
}

type StoredSessionValue = StoredTabSession | AudioConfig;

const pendingWrites = new Map<number, StoredSessionValue>();
const writeTimers = new Map<number, ReturnType<typeof setTimeout>>();
const writeRetries = new Map<number, number>();
const serialized = createKeyedSerializedQueue<number>();

function keyFor(tabId: number): string {
	return `${TAB_SESSION_PREFIX}${tabId}`;
}

function clearWriteTimer(tabId: number): void {
	const timer = writeTimers.get(tabId);
	if (timer !== undefined) clearTimeout(timer);
	writeTimers.delete(tabId);
}

function scheduleWrite(tabId: number): void {
	clearWriteTimer(tabId);
	writeTimers.set(tabId, setTimeout(() => {
		writeTimers.delete(tabId);
		void flushTabSessionConfig(tabId).catch(() => undefined);
	}, STORAGE_WRITE_DEBOUNCE_MS));
}

async function readStoredValue(tabId: number): Promise<unknown> {
	if (pendingWrites.has(tabId)) return pendingWrites.get(tabId);
	const key = keyFor(tabId);
	return (await chrome.storage.session.get(key))[key] as unknown;
}

async function flushTabSessionConfigInternal(tabId: number): Promise<void> {
	clearWriteTimer(tabId);
	const pending = pendingWrites.get(tabId);
	if (!pending) return;
	try {
		await chrome.storage.session.set({ [keyFor(tabId)]: pending });
		if (pendingWrites.get(tabId) === pending) pendingWrites.delete(tabId);
		writeRetries.delete(tabId);
	} catch (error) {
		const retries = (writeRetries.get(tabId) ?? 0) + 1;
		if (retries > MAX_WRITE_RETRIES) {
			writeRetries.delete(tabId);
			pendingWrites.delete(tabId);
			console.warn(`[tab-session] giving up on tab ${tabId} after ${MAX_WRITE_RETRIES} failed writes`);
			throw error;
		}
		writeRetries.set(tabId, retries);
		scheduleWrite(tabId);
		throw error;
	}
}

function isStoredTabSession(value: unknown): value is StoredTabSession {
	if (!value || typeof value !== 'object') return false;
	const record = value as Partial<StoredTabSession>;
	return !!record.identity
		&& Number.isInteger(record.identity.tabId)
		&& typeof record.identity.documentId === 'string'
		&& typeof record.identity.origin === 'string'
		&& !!record.config
		&& typeof record.config === 'object'
		&& typeof record.updatedAt === 'number';
}

function identitiesMatch(left: TabSessionIdentity, right: TabSessionIdentity): boolean {
	return left.tabId === right.tabId
		&& left.documentId === right.documentId
		&& left.origin === right.origin;
}

function originsMatch(left: TabSessionIdentity, right: TabSessionIdentity): boolean {
	return left.tabId === right.tabId && left.origin === right.origin;
}

function canonicalizeAudioConfig(value: Partial<AudioConfig>): AudioConfig {
	const volume = resolveAudioVolume({
		volume: value.volume ?? DEFAULT_AUDIO_CONFIG.volume,
		volumeBase: value.volumeBase,
		boost: value.boost,
	});
	return {
		...DEFAULT_AUDIO_CONFIG,
		...value,
		volume: volume.effectiveVolume,
		volumeBase: volume.volumeBase,
		boost: volume.boost,
	};
}

function mergeCanonicalAudioConfig(
	current: Partial<AudioConfig>,
	patch: Partial<AudioConfig>,
): AudioConfig {
	const merged = { ...current, ...patch };
	const legacyOnly = patch.volume !== undefined
		&& patch.volumeBase === undefined
		&& patch.boost === undefined;
	const volume = legacyOnly
		? resolveAudioVolume({ volume: patch.volume ?? DEFAULT_AUDIO_CONFIG.volume })
		: resolveAudioVolume({
			volume: merged.volume ?? DEFAULT_AUDIO_CONFIG.volume,
			volumeBase: merged.volumeBase,
			boost: merged.boost,
		});
	return {
		...DEFAULT_AUDIO_CONFIG,
		...merged,
		volume: volume.effectiveVolume,
		volumeBase: volume.volumeBase,
		boost: volume.boost,
	};
}

// eff: retrieves session config for a specific tab, returns null if no session exists
export async function getTabSessionConfig(tabId: number, identity?: TabSessionIdentity): Promise<AudioConfig | null> {
	const stored = await serialized(tabId, () => readStoredValue(tabId));
	if (!stored) return null;
	if (isStoredTabSession(stored)) {
		if (identity && !identitiesMatch(stored.identity, identity)) return null;
		return canonicalizeAudioConfig(stored.config);
	}
	// Legacy tabId-only entries cannot be proven to belong to the current document.
	if (identity) {
		await removeTabSessionConfig(tabId);
		return null;
	}
	return canonicalizeAudioConfig(stored as Partial<AudioConfig>);
}

// eff: saves session config for a specific tab
export async function setTabSessionConfig(
	tabId: number,
	config: Partial<AudioConfig>,
	identity?: TabSessionIdentity,
): Promise<void> {
	await serialized(tabId, async () => {
		const stored = await readStoredValue(tabId);
		if (!identity) {
			pendingWrites.set(tabId, isStoredTabSession(stored)
				? { ...stored, config: mergeCanonicalAudioConfig(stored.config, config), updatedAt: Date.now() }
				: mergeCanonicalAudioConfig(stored as Partial<AudioConfig>, config));
			scheduleWrite(tabId);
			return;
		}

		const existing = isStoredTabSession(stored) && identitiesMatch(stored.identity, identity)
			? stored.config
			: DEFAULT_AUDIO_CONFIG;
		pendingWrites.set(tabId, {
			identity,
			config: mergeCanonicalAudioConfig(existing, config),
			updatedAt: Date.now(),
		});
		scheduleWrite(tabId);
	});
}

// post: carries a tab's acknowledged config across a same-origin document
// replacement, while deleting it at a cross-origin boundary. Rebinding is
// explicit so ordinary reads remain side-effect free and stale documents can
// never claim a newer identity by merely querying storage.
export async function rebindTabSessionConfig(
	tabId: number,
	identity: TabSessionIdentity,
): Promise<AudioConfig | null> {
	return serialized(tabId, async () => {
		const stored = await readStoredValue(tabId);
		if (!stored) return null;
		if (!isStoredTabSession(stored) || !originsMatch(stored.identity, identity)) {
			clearWriteTimer(tabId);
			pendingWrites.delete(tabId);
			writeRetries.delete(tabId);
			await chrome.storage.session.remove(keyFor(tabId));
			return null;
		}

		const config = canonicalizeAudioConfig(stored.config);
		if (!identitiesMatch(stored.identity, identity)) {
			pendingWrites.set(tabId, {
				identity,
				config,
				updatedAt: Date.now(),
			});
			scheduleWrite(tabId);
		}
		return config;
	});
}

// eff: removes session config when tab is closed
export async function removeTabSessionConfig(tabId: number): Promise<void> {
	await serialized(tabId, async () => {
		clearWriteTimer(tabId);
		pendingWrites.delete(tabId);
		await chrome.storage.session.remove(keyFor(tabId));
	});
}

// post: writes the newest coalesced session state; callers use this at document lifecycle boundaries
export async function flushTabSessionConfig(tabId?: number): Promise<void> {
	if (tabId !== undefined) {
		await serialized(tabId, () => flushTabSessionConfigInternal(tabId));
		return;
	}
	await Promise.all([...pendingWrites.keys()].map((pendingTabId) => (
		serialized(pendingTabId, () => flushTabSessionConfigInternal(pendingTabId))
	)));
}

// eff: checks if a tab has an active session config
export async function hasTabSessionConfig(tabId: number, identity?: TabSessionIdentity): Promise<boolean> {
	return (await getTabSessionConfig(tabId, identity)) !== null;
}
