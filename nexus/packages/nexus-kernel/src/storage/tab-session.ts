// goal: manages tab-level session configs that persist across page refresh but not across tabs
// note: uses chrome.storage.session with tabId-prefixed keys

import { AudioConfig, DEFAULT_AUDIO_CONFIG } from '../messages/protocol.js';
import type { TabSessionIdentity } from '@nexus/contracts';

const TAB_SESSION_PREFIX = 'tab_session_';
const STORAGE_WRITE_DEBOUNCE_MS = 250;

interface StoredTabSession {
	identity: TabSessionIdentity;
	config: AudioConfig;
	updatedAt: number;
}

type StoredSessionValue = StoredTabSession | AudioConfig;

const pendingWrites = new Map<number, StoredSessionValue>();
const writeTimers = new Map<number, ReturnType<typeof setTimeout>>();
const operationQueues = new Map<number, Promise<void>>();

function keyFor(tabId: number): string {
	return `${TAB_SESSION_PREFIX}${tabId}`;
}

function serialized<T>(tabId: number, operation: () => Promise<T>): Promise<T> {
	const previous = operationQueues.get(tabId) ?? Promise.resolve();
	const result = previous.then(operation, operation);
	const tail = result.then(() => undefined, () => undefined);
	operationQueues.set(tabId, tail);
	void tail.finally(() => {
		if (operationQueues.get(tabId) === tail) operationQueues.delete(tabId);
	});
	return result;
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
		void flushTabSessionConfig(tabId);
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
	} catch (error) {
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

// eff: retrieves session config for a specific tab, returns null if no session exists
export async function getTabSessionConfig(tabId: number, identity?: TabSessionIdentity): Promise<AudioConfig | null> {
	const stored = await serialized(tabId, () => readStoredValue(tabId));
	if (!stored) return null;
	if (isStoredTabSession(stored)) {
		if (identity && !identitiesMatch(stored.identity, identity)) return null;
		return { ...DEFAULT_AUDIO_CONFIG, ...stored.config };
	}
	// Legacy tabId-only entries cannot be proven to belong to the current document.
	if (identity) {
		await removeTabSessionConfig(tabId);
		return null;
	}
	return { ...DEFAULT_AUDIO_CONFIG, ...(stored as Partial<AudioConfig>) };
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
				? { ...stored, config: { ...DEFAULT_AUDIO_CONFIG, ...stored.config, ...config }, updatedAt: Date.now() }
				: { ...DEFAULT_AUDIO_CONFIG, ...(stored as object), ...config });
			scheduleWrite(tabId);
			return;
		}

		const existing = isStoredTabSession(stored) && identitiesMatch(stored.identity, identity)
			? stored.config
			: DEFAULT_AUDIO_CONFIG;
		pendingWrites.set(tabId, {
			identity,
			config: { ...DEFAULT_AUDIO_CONFIG, ...existing, ...config },
			updatedAt: Date.now(),
		});
		scheduleWrite(tabId);
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
