// goal: collect bounded document-fenced observations for a card without waking background runtime work
// inv: these are independent observations, not an atomic transaction; control generations/revisions remain authoritative

import { createSettlementPool, observeWithin } from '@nexus/kernel';
import type { AudioRuntimeStatus, AudioSessionSnapshot, ControlSnapshot } from '@nexus/contracts';
import { sendSpectraRequest, sendSpectraTabRequest } from '../../shared/ui-spectra-client';
import { currentTopDocumentId, isCurrentTopDocument } from '../../shared/top-document';
import type { CardObservation, CardSnapshot } from './types';

export const CARD_SNAPSHOT_CONCURRENCY = 8;
const pendingReads = createSettlementPool<string, unknown>(64);
const CARD_SNAPSHOT_TIMEOUT_MS = 5_000;
const CARD_CACHE_PREFIX = 'spectra.popup.card_cache.';
const SNAPSHOT_CACHE_TTL_MS = 60_000;

interface CachedCardSnapshotRecord {
snapshot: CardSnapshot;
cachedAt: number;
}

const memoryCardSnapshotCache = new Map<number, CachedCardSnapshotRecord>();

export async function readCachedCardSnapshot(tabId: number): Promise<CardSnapshot | null> {
const inMem = memoryCardSnapshotCache.get(tabId);
if (inMem && Date.now() - inMem.cachedAt < SNAPSHOT_CACHE_TTL_MS) {
return { ...inMem.snapshot, fromCache: true };
}
try {
if (typeof chrome !== 'undefined' && chrome.storage?.session) {
const key = `${CARD_CACHE_PREFIX}${tabId}`;
const stored = (await chrome.storage.session.get(key)) as Record<string, unknown>;
const record = stored?.[key] as CachedCardSnapshotRecord | undefined;
if (record?.snapshot && Date.now() - record.cachedAt < SNAPSHOT_CACHE_TTL_MS) {
memoryCardSnapshotCache.set(tabId, record);
return { ...record.snapshot, fromCache: true };
}
}
} catch (error) {
console.debug('[SPECTRA Snapshot] Session storage read failed:', error);
}
return null;
}

export function writeCachedCardSnapshot(tabId: number, snapshot: CardSnapshot): void {
const cleanSnapshot: CardSnapshot = {
documentId: snapshot.documentId,
status: snapshot.status,
controlSnapshot: snapshot.controlSnapshot,
sessionSnapshot: snapshot.sessionSnapshot,
isRemoteActive: snapshot.isRemoteActive,
};
const record: CachedCardSnapshotRecord = { snapshot: cleanSnapshot, cachedAt: Date.now() };
memoryCardSnapshotCache.set(tabId, record);
try {
if (typeof chrome !== 'undefined' && chrome.storage?.session) {
const key = `${CARD_CACHE_PREFIX}${tabId}`;
void chrome.storage.session.set({ [key]: record }).catch((error: unknown) => {
console.debug('[SPECTRA Snapshot] Storage set failed:', error);
});
}
} catch (error) {
console.debug('[SPECTRA Snapshot] Session storage write failed:', error);
}
}

export function evictCachedCardSnapshot(tabId: number): void {
memoryCardSnapshotCache.delete(tabId);
try {
if (typeof chrome !== 'undefined' && chrome.storage?.session) {
const key = `${CARD_CACHE_PREFIX}${tabId}`;
void chrome.storage.session.remove(key).catch((error: unknown) => {
console.debug('[SPECTRA Snapshot] Storage remove failed:', error);
});
}
} catch (error) {
console.debug('[SPECTRA Snapshot] Storage operation failed:', error);
}
}

type ProcessorLifecycle = Pick<AudioRuntimeStatus, 'actualMode' | 'desiredMode' | 'phase' | 'generation'>;

export function resolveInitialProcessorLifecycle(
runtime: ProcessorLifecycle | null,
session: ProcessorLifecycle | null,
): ProcessorLifecycle | null {
const settled = runtime && (
runtime.actualMode === 'bypass' && runtime.phase === 'idle'
|| runtime.actualMode !== 'bypass' && runtime.phase === 'active'
);
return settled && (!session || runtime.generation >= session.generation) ? runtime : session;
}

export function hasKnownBackgroundRetentionInputs(snapshot: Pick<CardSnapshot, 'status' | 'isRemoteActive'>): boolean {
return snapshot.status.state === 'known' && snapshot.isRemoteActive.state === 'known';
}

async function observeSource<T>(
key: string,
start: () => Promise<unknown>,
project: (value: unknown) => T | null,
): Promise<CardObservation<T>> {
const operation = pendingReads.getOrStart(key, start);
if (!operation) return { state: 'unknown', reason: 'capacity' };
try {
const observed = await observeWithin(operation, CARD_SNAPSHOT_TIMEOUT_MS);
if (!observed.settled) return { state: 'unknown', reason: 'timeout' };
const value = project(observed.value);
return value === null ? { state: 'unknown', reason: 'rejected' } : { state: 'known', value };
} catch {
return { state: 'unknown', reason: 'unavailable' };
}
}

export async function collectCardSnapshot(tabId: number): Promise<CardSnapshot | null> {
const documentId = await currentTopDocumentId(tabId);
if (!documentId) return null;
const key = `${tabId}:${documentId}`;
const [status, controlSnapshot, sessionSnapshot, isRemoteActive] = await Promise.all([
observeSource(
`${key}:runtime`,
() => sendSpectraTabRequest(tabId, 'spectra.audio.runtime.get', {}, { documentId }),
(value) => (value as Awaited<ReturnType<typeof sendSpectraTabRequest<'spectra.audio.runtime.get'>>>).ok
? (value as { ok: true; data: AudioRuntimeStatus }).data
: null,
),
observeSource(
`${key}:control`,
() => sendSpectraRequest('spectra.control.snapshot.get', { tabId }, { tabId, documentId }),
(value) => {
const response = value as Awaited<ReturnType<typeof sendSpectraRequest<'spectra.control.snapshot.get'>>>;
return response.ok && (!response.data || response.data.documentId === documentId)
? { value: response.data }
: null;
},
).then((result): CardObservation<ControlSnapshot | null> => (
result.state === 'known' ? { state: 'known', value: result.value.value } : result
)),
observeSource(
`${key}:session`,
() => sendSpectraRequest('spectra.audio.session.get', { tabId }, { tabId }),
(value) => {
const response = value as Awaited<ReturnType<typeof sendSpectraRequest<'spectra.audio.session.get'>>>;
return response.ok && (!response.data || response.data.documentId === documentId)
? { value: response.data }
: null;
},
).then((result): CardObservation<AudioSessionSnapshot | null> => (
result.state === 'known' ? { state: 'known', value: result.value.value } : result
)),
observeSource(
`${key}:remote`,
() => sendSpectraRequest('spectra.remote.session.get', { tabId }, { tabId }),
(value) => {
const response = value as Awaited<ReturnType<typeof sendSpectraRequest<'spectra.remote.session.get'>>>;
return response.ok ? response.data.connected : null;
},
),
]);
if (!await isCurrentTopDocument(tabId, documentId)) return null;

let effectiveControl: CardObservation<ControlSnapshot | null> = controlSnapshot;
if (effectiveControl.state === 'unknown') {
const cached = memoryCardSnapshotCache.get(tabId)?.snapshot;
if (cached?.documentId === documentId && cached.controlSnapshot.state === 'known') {
effectiveControl = cached.controlSnapshot;
} else {
try {
if (typeof chrome !== 'undefined' && chrome.storage?.session) {
const stored = (await chrome.storage.session.get(`spectra.control.tab.${tabId}`)) as Record<string, unknown>;
const bgSnapshot = stored?.[ `spectra.control.tab.${tabId}` ] as ControlSnapshot | undefined;
if (bgSnapshot && bgSnapshot.documentId === documentId) {
effectiveControl = { state: 'known', value: bgSnapshot };
}
}
} catch (error) {
console.debug('[SPECTRA Snapshot] Storage operation failed:', error);
}
}
}

let effectiveSession: CardObservation<AudioSessionSnapshot | null> = sessionSnapshot;
if (effectiveSession.state === 'unknown') {
const cached = memoryCardSnapshotCache.get(tabId)?.snapshot;
if (cached?.documentId === documentId && cached.sessionSnapshot.state === 'known') {
effectiveSession = cached.sessionSnapshot;
} else {
try {
if (typeof chrome !== 'undefined' && chrome.storage?.session) {
const stored = (await chrome.storage.session.get(`spectra.audio.session.${tabId}`)) as Record<string, unknown>;
const bgSession = stored?.[ `spectra.audio.session.${tabId}` ] as AudioSessionSnapshot | undefined;
if (bgSession && bgSession.documentId === documentId) {
effectiveSession = { state: 'known', value: bgSession };
}
}
} catch (error) {
console.debug('[SPECTRA Snapshot] Storage operation failed:', error);
}
}
}

const snapshot: CardSnapshot = {
documentId,
status,
controlSnapshot: effectiveControl,
sessionSnapshot: effectiveSession,
isRemoteActive,
};
if (effectiveControl.state === 'known' || status.state === 'known') {
writeCachedCardSnapshot(tabId, snapshot);
}
return snapshot;
}

export function updateCachedControlSnapshot(tabId: number, controlSnapshot: ControlSnapshot): void {
  const existing = memoryCardSnapshotCache.get(tabId)?.snapshot;
  writeCachedCardSnapshot(tabId, {
    documentId: controlSnapshot.documentId,
    status: existing?.status ?? { state: 'unknown', reason: 'unavailable' },
    controlSnapshot: { state: 'known', value: controlSnapshot },
    sessionSnapshot: existing?.sessionSnapshot ?? { state: 'unknown', reason: 'unavailable' },
    isRemoteActive: existing?.isRemoteActive ?? { state: 'unknown', reason: 'unavailable' },
  });
}

export async function readCardSnapshot(tabId: number, options?: { allowCached?: boolean }): Promise<CardSnapshot | null> {
  if (!Number.isSafeInteger(tabId) || tabId <= 0) throw new Error('card snapshot requires a valid tab');
  if (options?.allowCached ?? true) {
    const cached = await readCachedCardSnapshot(tabId);
    if (cached) {
      const currentDocId = await currentTopDocumentId(tabId);
      if (currentDocId && currentDocId === cached.documentId) {
        return cached;
      }
    }
  }
  return collectCardSnapshot(tabId);
}
