// goal: collect bounded document-fenced observations for a card without waking background runtime work
// inv: these are independent observations, not an atomic transaction; control generations/revisions remain authoritative

import { createSettlementPool, observeWithin } from '@nexus/kernel';
import type { AudioRuntimeStatus, AudioSessionSnapshot, ControlSnapshot } from '@nexus/contracts';
import { audioSessionMatchesControlDocument } from '@nexus/contracts';
import { resolveAcknowledgedProcessorLifecycle } from '@nexus/contracts/ui-runtime';
import { sendSpectraRequest, sendSpectraTabRequest } from '../../shared/ui-spectra-client';
import { currentTopDocumentId, isCurrentTopDocument } from '../../shared/top-document';
import type { CardObservation, CardSnapshot } from './types';

export const CARD_SNAPSHOT_CONCURRENCY = 8;
const pendingReads = createSettlementPool<string, unknown>(64);
// This is a bound, not a latency budget: every source is read in parallel and
// single-flighted, so the happy path never waits for it. Cutting it short only
// converts a slow-but-correct read into a permanent unknown, and a card that
// does not know its own route paints the wrong colour until the Popup reopens.
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

/**
 * The processor lifecycle the control snapshot itself acknowledges.
 *
 * A snapshot's fields are the only per-field truth the card trusts, and a
 * processor field ACK (one applied by the capture or the Web Audio writer) *is*
 * a lifecycle statement: it says the audio is routed that way right now. Reading
 * the lifecycle from it removes the last reason the card had to depend on a
 * second, slower read for its route colour - the runtime and session
 * observations can only make that answer fresher, never make it exist.
 */
export function acknowledgedProcessorLifecycle(
	control: Pick<ControlSnapshot, 'fields' | 'generation'> | null,
): ProcessorLifecycle | null {
	if (!control) return null;
	const acknowledged = resolveAcknowledgedProcessorLifecycle(control.fields);
	return acknowledged
		? { ...acknowledged, desiredMode: acknowledged.actualMode, generation: control.generation }
		: null;
}

/**
 * Picks the lifecycle the first paint and every later render must use.
 *
 * All three sources describe the same thing at different times, so the newest
 * generation wins; on a tie the more authoritative source wins, and the order of
 * the candidates is that authority: an acknowledged control field, then the
 * settled content runtime, then the session snapshot. A runtime read that is
 * still mid-transition is never presented as a final colour (its phase is not
 * settled yet), while a session newer than the acknowledgment still wins,
 * because it describes a hand-off the snapshot has not published yet.
 */
export function resolveInitialProcessorLifecycle(
	runtime: ProcessorLifecycle | null,
	session: ProcessorLifecycle | null,
	acknowledged: ProcessorLifecycle | null = null,
): ProcessorLifecycle | null {
	const settledRuntime = runtime && (
		runtime.actualMode === 'bypass' && runtime.phase === 'idle'
		|| runtime.actualMode !== 'bypass' && runtime.phase === 'active'
	) ? runtime : null;
	const candidates = [acknowledged, settledRuntime, session].filter(
		(candidate): candidate is ProcessorLifecycle => candidate !== null,
	);
	if (candidates.length === 0) return null;
	return candidates.reduce((best, candidate) => (
		candidate.generation > best.generation ? candidate : best
	));
}

export function hasKnownBackgroundRetentionInputs(snapshot: Pick<CardSnapshot, 'status' | 'isRemoteActive'>): boolean {
	return snapshot.status.state === 'known' && snapshot.isRemoteActive.state === 'known';
}

/**
 * Whether a session snapshot belongs to the document this card is showing.
 *
 * The control projection is the usual witness, but it is an *independent*
 * observation that can be slower than the session. A card whose control read is
 * still in flight must not conclude that a session naming its own document is
 * somebody else's, or a slow control read would also erase the route colour.
 * The card's exact document id is the fence either way.
 */
export function sessionBelongsToCard(
	session: AudioSessionSnapshot | null,
	control: Pick<ControlSnapshot, 'tabId' | 'documentId' | 'origin'> | null,
	documentId: string,
): boolean {
	if (!session) return false;
	if (control) return audioSessionMatchesControlDocument(session, control);
	return documentId.length > 0 && session.documentId === documentId;
}

// note: a projection returns null when the response cannot be trusted at all,
// and { value } when it can - `value` may itself be null (a tab with no session),
// which must stay distinguishable from a rejected read.
type Projected<T> = { value: T } | null;

async function observeSource<T>(
	key: string,
	start: () => Promise<unknown>,
	project: (value: unknown) => Projected<T>,
): Promise<CardObservation<T>> {
	const operation = pendingReads.getOrStart(key, start);
	if (!operation) return { state: 'unknown', reason: 'capacity' };
	try {
		const observed = await observeWithin(operation, CARD_SNAPSHOT_TIMEOUT_MS);
		if (!observed.settled) return { state: 'unknown', reason: 'timeout' };
		const projected = project(observed.value);
		return projected === null
			? { state: 'unknown', reason: 'rejected' }
			: { state: 'known', value: projected.value };
	} catch {
		return { state: 'unknown', reason: 'unavailable' };
	}
}

export async function collectCardSnapshot(tabId: number): Promise<CardSnapshot | null> {
	const documentId = await currentTopDocumentId(tabId);
	if (!documentId) return null;
	const key = `${tabId}:${documentId}`;
	const [status, controlSnapshot, sessionSnapshot, isRemoteActive] = await Promise.all([
		observeSource<AudioRuntimeStatus>(
			`${key}:runtime`,
			() => sendSpectraTabRequest(tabId, 'spectra.audio.runtime.get', {}, { documentId }),
			(value) => {
				const response = value as Awaited<ReturnType<typeof sendSpectraTabRequest<'spectra.audio.runtime.get'>>>;
				return response.ok && response.data ? { value: response.data } : null;
			},
		),
		observeSource<ControlSnapshot | null>(
			`${key}:control`,
			() => sendSpectraRequest('spectra.control.snapshot.get', { tabId }, { tabId, documentId }),
			(value) => {
				const response = value as Awaited<ReturnType<typeof sendSpectraRequest<'spectra.control.snapshot.get'>>>;
				return response.ok && (!response.data || response.data.documentId === documentId)
					? { value: response.data }
					: null;
			},
		),
		observeSource<AudioSessionSnapshot | null>(
			`${key}:session`,
			() => sendSpectraRequest('spectra.audio.session.get', { tabId }, { tabId }),
			(value) => {
				const response = value as Awaited<ReturnType<typeof sendSpectraRequest<'spectra.audio.session.get'>>>;
				return response.ok && (!response.data || response.data.documentId === documentId)
					? { value: response.data }
					: null;
			},
		),
		observeSource<boolean>(
			`${key}:remote`,
			() => sendSpectraRequest('spectra.remote.session.get', { tabId }, { tabId }),
			(value) => {
				const response = value as Awaited<ReturnType<typeof sendSpectraRequest<'spectra.remote.session.get'>>>;
				return response.ok ? { value: response.data.connected } : null;
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
					const storageKey = `spectra.control.tab.${tabId}`;
					const stored = (await chrome.storage.session.get(storageKey)) as Record<string, unknown>;
					const bgSnapshot = stored?.[storageKey] as ControlSnapshot | undefined;
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
					const storageKey = `spectra.audio.session.${tabId}`;
					const stored = (await chrome.storage.session.get(storageKey)) as Record<string, unknown>;
					const bgSession = stored?.[storageKey] as AudioSessionSnapshot | undefined;
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
	writeCachedCardSnapshot(tabId, snapshot);
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

export async function readCardSnapshot(
	tabId: number,
	options?: { allowCached?: boolean },
): Promise<CardSnapshot | null> {
	if (!Number.isSafeInteger(tabId) || tabId <= 0) throw new Error('card snapshot requires a valid tab');
	if (options?.allowCached ?? true) {
		const cached = await readCachedCardSnapshot(tabId);
		if (cached) {
			// The cache saves the four cross-context reads, never the document
			// fence: a tab that navigated inside the TTL would otherwise hand the
			// card a snapshot the card is then forced to reject, painting no card
			// at all.
			const currentDocumentId = await currentTopDocumentId(tabId);
			if (currentDocumentId && currentDocumentId === cached.documentId) return cached;
		}
	}
	return collectCardSnapshot(tabId);
}
