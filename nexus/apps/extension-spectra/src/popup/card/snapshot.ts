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

// The card cache is the last known-good CardSnapshot for one document. It is
// document-fenced, not time-bounded: a stored record is retired when the read
// fence sees a different document (navigation), and it lives in
// chrome.storage.local so a Popup opened after a browser restart does not start
// from a blank list and re-read every cross-context source. There is
// deliberately no TTL - a fact stops being true when its document changes,
// never because a counter ran out.
interface CachedCardSnapshotRecord {
	snapshot: CardSnapshot;
}

const memoryCardSnapshotCache = new Map<number, CachedCardSnapshotRecord>();

export async function readCachedCardSnapshot(tabId: number): Promise<CardSnapshot | null> {
	const inMem = memoryCardSnapshotCache.get(tabId);
	if (inMem) {
		return { ...inMem.snapshot, fromCache: true };
	}
	try {
		if (typeof chrome !== 'undefined' && chrome.storage?.local) {
			const key = `${CARD_CACHE_PREFIX}${tabId}`;
			const stored = (await chrome.storage.local.get(key)) as Record<string, unknown>;
			const record = stored?.[key] as CachedCardSnapshotRecord | undefined;
			if (record?.snapshot) {
				memoryCardSnapshotCache.set(tabId, record);
				return { ...record.snapshot, fromCache: true };
			}
		}
	} catch (error) {
		console.debug('[SPECTRA Snapshot] Local storage read failed:', error);
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
	const record: CachedCardSnapshotRecord = { snapshot: cleanSnapshot };
	memoryCardSnapshotCache.set(tabId, record);
	try {
		if (typeof chrome !== 'undefined' && chrome.storage?.local) {
			const key = `${CARD_CACHE_PREFIX}${tabId}`;
			void chrome.storage.local.set({ [key]: record }).catch((error: unknown) => {
				console.debug('[SPECTRA Snapshot] Storage set failed:', error);
			});
		}
	} catch (error) {
		console.debug('[SPECTRA Snapshot] Local storage write failed:', error);
	}
}

export function evictCachedCardSnapshot(tabId: number): void {
	memoryCardSnapshotCache.delete(tabId);
	try {
		if (typeof chrome !== 'undefined' && chrome.storage?.local) {
			const key = `${CARD_CACHE_PREFIX}${tabId}`;
			void chrome.storage.local.remove(key).catch((error: unknown) => {
				console.debug('[SPECTRA Snapshot] Storage remove failed:', error);
			});
		}
	} catch (error) {
		console.debug('[SPECTRA Snapshot] Storage operation failed:', error);
	}
}

// The background owns these two durable keys and retires them on navigation and
// tab removal: the control snapshot and the audio session are persisted to
// chrome.storage.local on every commit and deleted when the document changes. A
// present value is therefore a value for the current document, so the card can
// paint its controls and route from them before any RPC answers. They are never
// a second source of truth - the RPC below still reconciles drift on open.
const CONTROL_SNAPSHOT_KEY_PREFIX = 'spectra.control.tab.';
const AUDIO_SESSION_KEY_PREFIX = 'spectra_audio_session_';

interface DurableCardFacts {
	control: ControlSnapshot | null;
	session: AudioSessionSnapshot | null;
}

async function readDurableCardFacts(
	tabId: number,
	documentId: string,
): Promise<DurableCardFacts> {
	if (typeof chrome === 'undefined' || !chrome.storage?.local) {
		return { control: null, session: null };
	}
	const controlKey = `${CONTROL_SNAPSHOT_KEY_PREFIX}${tabId}`;
	const sessionKey = `${AUDIO_SESSION_KEY_PREFIX}${tabId}`;
	try {
		const stored = (await chrome.storage.local.get([controlKey, sessionKey])) as Record<string, unknown>;
		const control = (stored[controlKey] as ControlSnapshot | undefined) ?? null;
		const session = (stored[sessionKey] as AudioSessionSnapshot | undefined) ?? null;
		return {
			control: control && control.documentId === documentId ? control : null,
			session: session && session.documentId === documentId ? session : null,
		};
	} catch (error) {
		console.debug('[SPECTRA Snapshot] Durable fact read failed:', error);
		return { control: null, session: null };
	}
}

type ProcessorLifecycle = Pick<AudioRuntimeStatus, 'actualMode' | 'desiredMode' | 'phase' | 'generation'>;
type AcknowledgedProcessorLifecycle = Omit<ProcessorLifecycle, 'generation'>;

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
	control: Pick<ControlSnapshot, 'fields'> | null,
): AcknowledgedProcessorLifecycle | null {
	if (!control) return null;
	const acknowledged = resolveAcknowledgedProcessorLifecycle(control.fields);
	return acknowledged
		? { ...acknowledged, desiredMode: acknowledged.actualMode }
		: null;
}

/**
 * Picks the lifecycle the first paint and every later render must use.
 *
 * Runtime and session share the processor generation clock. Control field ACKs
 * have an independent document-control clock and supply a fallback when neither
 * processor observation answers. Never seed the audio watermark from control.
 */
export function resolveInitialProcessorLifecycle(
	runtime: ProcessorLifecycle | null,
	session: ProcessorLifecycle | null,
	acknowledged: AcknowledgedProcessorLifecycle | null = null,
): ProcessorLifecycle | AcknowledgedProcessorLifecycle | null {
	const settledRuntime = runtime && (
		runtime.actualMode === 'bypass' && runtime.phase === 'idle'
		|| runtime.actualMode !== 'bypass' && runtime.phase === 'active'
	) ? runtime : null;
	const candidates = [settledRuntime, session].filter(
		(candidate): candidate is ProcessorLifecycle => candidate !== null,
	);
	if (candidates.length === 0) return acknowledged;
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

function observeControlSnapshot(tabId: number, documentId: string): Promise<CardObservation<ControlSnapshot | null>> {
	return observeSource<ControlSnapshot | null>(
		`${tabId}:${documentId}:control`,
		() => sendSpectraRequest('spectra.control.snapshot.get', { tabId }, { tabId, documentId }),
		(value) => {
			const response = value as Awaited<ReturnType<typeof sendSpectraRequest<'spectra.control.snapshot.get'>>>;
			return response.ok && (!response.data || response.data.documentId === documentId)
				? { value: response.data }
				: null;
		},
	);
}

function preserveControlForecast(
	current: CardObservation<ControlSnapshot | null>,
	forecast: ControlSnapshot | null,
): CardObservation<ControlSnapshot | null> {
	if (current.state === 'known' || !forecast) return current;
	const fields = { ...forecast.fields };
	delete fields.playing;
	return { state: 'known', value: { ...forecast, fields } };
}

/** Initial presentation never waits for Content, worker restore, or remote RPC.
 * Media identity is still fenced by Chrome; actual playback is confirmed only
 * by the existing messaging reducer after the same DOM has been bound. */
export async function readInitialCardSnapshot(tabId: number): Promise<CardSnapshot | null> {
	const documentId = await currentTopDocumentId(tabId);
	if (!documentId) return null;
	const [cached, durable] = await Promise.all([readCachedCardSnapshot(tabId), readDurableCardFacts(tabId, documentId)]);
	const matchingCache = cached?.documentId === documentId ? cached : null;
	const forecast = durable.control ?? (matchingCache?.controlSnapshot.state === 'known' ? matchingCache.controlSnapshot.value : null);
	return {
		documentId,
		status: { state: 'unknown', reason: 'unavailable' },
		controlSnapshot: preserveControlForecast({ state: 'unknown', reason: 'unavailable' }, forecast),
		sessionSnapshot: durable.session ? { state: 'known', value: durable.session } : { state: 'unknown', reason: 'unavailable' },
		isRemoteActive: { state: 'unknown', reason: 'unavailable' },
		fromCache: true, controlSnapshotFresh: false,
	};
}

export async function collectCardSnapshot(tabId: number): Promise<CardSnapshot | null> {
	const documentId = await currentTopDocumentId(tabId);
	if (!documentId) return null;
	const key = `${tabId}:${documentId}`;
	// A durable control ACK identifies the document but cannot prove current
	// playback after an observation lease was closed. Always reconcile control
	// through the passive getter; the durable session still owns processor state.
	const durable = await readDurableCardFacts(tabId, documentId);
	const [status, controlSnapshot, sessionSnapshot, isRemoteActive] = await Promise.all([
		observeSource<AudioRuntimeStatus>(
			`${key}:runtime`,
			() => sendSpectraTabRequest(tabId, 'spectra.audio.runtime.get', {}, { documentId }),
			(value) => {
				const response = value as Awaited<ReturnType<typeof sendSpectraTabRequest<'spectra.audio.runtime.get'>>>;
				return response.ok && response.data ? { value: response.data } : null;
			},
		),
		observeControlSnapshot(tabId, documentId),
		durable.session !== null
			? Promise.resolve<CardObservation<AudioSessionSnapshot | null>>({ state: 'known', value: durable.session })
			: observeSource<AudioSessionSnapshot | null>(
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

	const snapshot: CardSnapshot = {
		documentId,
		status,
		controlSnapshot: preserveControlForecast(controlSnapshot, durable.control),
		controlSnapshotFresh: controlSnapshot.state === 'known',
		sessionSnapshot,
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

/**
 * The cached forecast, with its route refreshed from the durable facts.
 *
 * The cache exists so the first paint never waits on a cross-context read. It
 * cannot be fresher than the background's own durable record, though: it is a
 * *copy* of an older observation. A cached `bypass` route painting over a live
 * Capture session is exactly the reopen that showed a violet bar turning blue,
 * so the cheap durable read runs here too and wins whenever it has a value.
 */
async function readCachedCardSnapshotWithDurableRoute(tabId: number): Promise<CardSnapshot | null> {
	const cached = await readCachedCardSnapshot(tabId);
	if (!cached) return null;
	const [durable, control] = await Promise.all([
		readDurableCardFacts(tabId, cached.documentId),
		observeControlSnapshot(tabId, cached.documentId),
	]);
	return {
		...cached,
		// Retain the route forecast on read failure, but never its stale playback.
		controlSnapshot: preserveControlForecast(control, durable.control
			?? (cached.controlSnapshot.state === 'known' ? cached.controlSnapshot.value : null)),
		controlSnapshotFresh: control.state === 'known',
		sessionSnapshot: durable.session
			? { state: 'known', value: durable.session }
			: cached.sessionSnapshot,
	};
}

export async function readCardSnapshot(
	tabId: number,
	options?: { allowCached?: boolean },
): Promise<CardSnapshot | null> {
	if (!Number.isSafeInteger(tabId) || tabId <= 0) throw new Error('card snapshot requires a valid tab');
	if (options?.allowCached ?? true) {
		const cached = await readCachedCardSnapshotWithDurableRoute(tabId);
		// The background retires the cache key on navigation and tab removal, so a
		// stored record supplies the processor route forecast. Playback is
		// refreshed through the same bounded passive getter before first paint;
		// init still verifies the document before committing the card DOM.
		if (cached) return cached;
	}
	return collectCardSnapshot(tabId);
}
