// goal: persist acknowledged per-document audio snapshots across service-worker restarts

import {
	clampControlValue,
	compileEffectiveVolume,
	createBoundedMap,
	describeRejection,
	DEFAULT_AUDIO_CONFIG,
	isRetryableRejection,
	isAudioSessionError,
	isAudioSessionSnapshot,
	isLegacyAudioConfig,
	normalizeLegacyAudioConfig,
	resolveAudioVolume,
	splitEffectiveVolume,
	accept,
	createSpectraEvent,
	reject,
	type Rejection,
	type Verdict,
	type AudioConfig,
	type LegacyAudioConfig,
	type AudioSessionPhase,
	type AudioSessionSnapshot,
	type SpectraAudioMode,
	type TabSessionIdentity,
} from '@nexus/contracts';
import { createKeyedSerializedQueue } from '@nexus/kernel';
import { reconcileAudioSessionPhase, shouldAcceptAudioSessionPhase } from '../shared/audio-session-phase';
import { swLog } from '../shared/logger';

const KEY_PREFIX = 'spectra_audio_session_';
const STORAGE_WRITE_DEBOUNCE_MS = 250;
const MAX_WRITE_RETRIES = 5;
const snapshots = new Map<number, AudioSessionSnapshot>();
const serialized = createKeyedSerializedQueue<number>();
// Runtime messages and badge rendering are presentation work. They preserve
// per-tab order, but never occupy the durable session authority queue: a slow
// optional receiver must not delay the next physical/session ACK.
const projectionSerialized = createKeyedSerializedQueue<number>();
interface AudioDocumentFence {
	epoch: number;
	currentDocumentId: string | null;
	retiredDocumentId: string | null;
	awaitingDocument: boolean;
}

// Keep only the current document, the one retired document, and a monotonic
// epoch. The epoch protects continuations that were already awaiting storage;
// the bounded identity fields reject late senders without retaining history.
const documentFences = new Map<number, AudioDocumentFence>();
const pendingWrites = new Map<number, AudioSessionSnapshot>();
const writeTimers = new Map<number, ReturnType<typeof setTimeout>>();
const retryCounts = new Map<number, number>();
/**
 * Why the most recent write for a tab was refused, if it was.
 *
 * Every admission path used to answer `return base` — the refusal happened and
 * nothing could say which kind it was, which is exactly how a dead state
 * survived for months. The ledger is bounded because it exists per tab and has
 * no eviction of its own (INV-12).
 */
const sessionRejections = createBoundedMap<number, Rejection>({
	cap: 256,
	ttlMs: 300_000,
});

type LegacyAudioSessionSnapshot = Omit<AudioSessionSnapshot, 'actualConfig' | 'desiredMode' | 'actualMode'> & {
	desiredMode: 'bypass' | 'webaudio' | 'capture';
	actualMode: 'bypass' | 'webaudio' | 'capture';
	actualConfig: LegacyAudioConfig;
};

const AUDIO_SESSION_SNAPSHOT_KEYS = new Set([
	'tabId',
	'documentId',
	'origin',
	'generation',
	'desiredMode',
	'actualMode',
	'phase',
	'configRevision',
	'actualConfig',
	'lastError',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
	return Object.keys(value).every((key) => allowed.has(key));
}

function isCanonicalOrigin(value: unknown): value is string {
	if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false;
	try {
		const url = new URL(value);
		return url.origin !== 'null' && url.origin === value;
	} catch {
		return false;
	}
}

function isLegacyAudioSessionSnapshot(value: unknown): value is LegacyAudioSessionSnapshot {
	if (!isRecord(value) || !hasOnlyKeys(value, AUDIO_SESSION_SNAPSHOT_KEYS)) return false;
	return Number.isInteger(value.tabId)
		&& Number(value.tabId) > 0
		&& typeof value.documentId === 'string'
		&& value.documentId.length > 0
		&& value.documentId.length <= 256
		&& isCanonicalOrigin(value.origin)
		&& Number.isInteger(value.generation)
		&& Number(value.generation) >= 0
		&& (value.desiredMode === 'bypass' || value.desiredMode === 'webaudio' || value.desiredMode === 'capture')
		&& (value.actualMode === 'bypass' || value.actualMode === 'webaudio' || value.actualMode === 'capture')
		&& (value.phase === 'idle' || value.phase === 'starting' || value.phase === 'active'
			|| value.phase === 'stopping' || value.phase === 'error')
		&& Number.isInteger(value.configRevision)
		&& Number(value.configRevision) >= 0
		&& isLegacyAudioConfig(value.actualConfig)
		&& (value.lastError === null || isAudioSessionError(value.lastError));
}

export class StaleAudioSessionError extends Error {
	constructor() {
		super('Audio session update belongs to an invalidated document');
		this.name = 'StaleAudioSessionError';
	}
}

function key(tabId: number): string {
	return `${KEY_PREFIX}${tabId}`;
}

export function identityFromSender(sender: chrome.runtime.MessageSender): TabSessionIdentity | null {
	const tabId = sender.tab?.id;
	const sourceUrl = sender.url ?? sender.tab?.url;
	if (sender.id !== chrome.runtime.id || !tabId || !sourceUrl || !sender.documentId?.trim()) return null;
	try {
		const origin = new URL(sourceUrl).origin;
		if (origin === 'null') return null;
		if (sender.url && sender.tab?.url) {
			const currentOrigin = new URL(sender.tab.url).origin;
			if (currentOrigin !== 'null' && currentOrigin !== origin) return null;
		}
		return { tabId, documentId: sender.documentId, origin };
	} catch {
		return null;
	}
}

function clearWriteTimer(tabId: number): void {
	const timer = writeTimers.get(tabId);
	if (timer !== undefined) clearTimeout(timer);
	writeTimers.delete(tabId);
}

function documentFenceFor(tabId: number): AudioDocumentFence {
	let fence = documentFences.get(tabId);
	if (!fence) {
		fence = {
			epoch: 0,
			currentDocumentId: snapshots.get(tabId)?.documentId ?? null,
			retiredDocumentId: null,
			awaitingDocument: false,
		};
		documentFences.set(tabId, fence);
	}
	return fence;
}

function assertAudioSessionFence(
	identity: TabSessionIdentity,
	expectedEpoch: number,
): void {
	const fence = documentFences.get(identity.tabId);
	if (!fence
		|| fence.epoch !== expectedEpoch
		|| fence.awaitingDocument
		|| fence.retiredDocumentId === identity.documentId
		|| fence.currentDocumentId !== identity.documentId) {
		throw new StaleAudioSessionError();
	}
}

/** Advance the audio lifecycle before any navigation/close async work starts. */
export function fenceAudioSession(tabId: number, preserveDocumentState = false): number {
	const fence = documentFenceFor(tabId);
	const currentDocumentId = fence.currentDocumentId ?? snapshots.get(tabId)?.documentId ?? null;
	fence.epoch += 1;
	if (preserveDocumentState) {
		fence.currentDocumentId = currentDocumentId;
		fence.awaitingDocument = currentDocumentId === null;
	} else {
		if (currentDocumentId !== null) fence.retiredDocumentId = currentDocumentId;
		fence.currentDocumentId = null;
		fence.awaitingDocument = true;
	}
	clearWriteTimer(tabId);
	pendingWrites.delete(tabId);
	retryCounts.delete(tabId);
	return fence.epoch;
}

/** Bind the post-commit document so pre-commit late senders stay rejected. */
export function bindAudioSessionDocument(tabId: number, documentId: string): void {
	const fence = documentFenceFor(tabId);
	if (fence.retiredDocumentId === documentId) return;
	if (fence.currentDocumentId !== null && fence.currentDocumentId !== documentId) {
		fence.retiredDocumentId = fence.currentDocumentId;
		fence.epoch += 1;
	}
	fence.currentDocumentId = documentId;
	fence.awaitingDocument = false;
}

function prepareAudioSessionIdentity(identity: TabSessionIdentity): number {
	const fence = documentFenceFor(identity.tabId);
	if (fence.awaitingDocument || fence.retiredDocumentId === identity.documentId) {
		throw new StaleAudioSessionError();
	}
	if (fence.currentDocumentId === null) {
		fence.currentDocumentId = identity.documentId;
		fence.awaitingDocument = false;
	} else if (fence.currentDocumentId !== identity.documentId) {
		fence.retiredDocumentId = fence.currentDocumentId;
		fence.currentDocumentId = identity.documentId;
		fence.awaitingDocument = false;
		fence.epoch += 1;
	}
	return fence.epoch;
}

function isCurrentAudioSnapshot(
	tabId: number,
	snapshot: AudioSessionSnapshot,
	expectedEpoch?: number,
): boolean {
	const fence = documentFences.get(tabId);
	if (!fence) return expectedEpoch === undefined;
	return (expectedEpoch === undefined || fence.epoch === expectedEpoch)
		&& !fence.awaitingDocument
		&& fence.retiredDocumentId !== snapshot.documentId
		&& (fence.currentDocumentId === null || fence.currentDocumentId === snapshot.documentId);
}

async function discardFencedAudioSnapshot(
	tabId: number,
	snapshot: AudioSessionSnapshot,
): Promise<void> {
	if (snapshots.get(tabId) === snapshot) snapshots.delete(tabId);
	if (pendingWrites.get(tabId) === snapshot) pendingWrites.delete(tabId);
	await chrome.storage.local.remove(key(tabId)).catch(() => undefined);
}

function scheduleWrite(tabId: number, snapshot: AudioSessionSnapshot, delay = STORAGE_WRITE_DEBOUNCE_MS): void {
	pendingWrites.set(tabId, snapshot);
	clearWriteTimer(tabId);
	writeTimers.set(tabId, setTimeout(() => {
		writeTimers.delete(tabId);
		void flushAudioSessions(tabId).catch(() => undefined);
	}, delay));
}

async function flushAudioSessionInternal(tabId: number): Promise<void> {
	clearWriteTimer(tabId);
	const pending = pendingWrites.get(tabId);
	if (!pending) {
		retryCounts.delete(tabId);
		return;
	}
	const expectedEpoch = documentFenceFor(tabId).epoch;
	try {
		await chrome.storage.local.set({ [key(tabId)]: pending });
		const fence = documentFenceFor(tabId);
		if (fence.epoch !== expectedEpoch) {
			await chrome.storage.local.remove(key(tabId)).catch(() => undefined);
			if (pendingWrites.get(tabId) === pending) pendingWrites.delete(tabId);
			retryCounts.delete(tabId);
			return;
		}
		if (pendingWrites.get(tabId) === pending) pendingWrites.delete(tabId);
		retryCounts.delete(tabId);
	} catch (error) {
		if (documentFenceFor(tabId).epoch !== expectedEpoch) {
			pendingWrites.delete(tabId);
			retryCounts.delete(tabId);
			return;
		}
		const retries = (retryCounts.get(tabId) ?? 0) + 1;
		if (retries > MAX_WRITE_RETRIES) {
			swLog.warn(
				`[AudioSession] Storage write failed after ${MAX_WRITE_RETRIES} retries, dropping snapshot for tab ${tabId}`,
				error,
			);
			pendingWrites.delete(tabId);
			retryCounts.delete(tabId);
			return;
		}
		retryCounts.set(tabId, retries);
		const backoffDelay = STORAGE_WRITE_DEBOUNCE_MS * 2 ** (retries - 1);
		scheduleWrite(tabId, pending, backoffDelay);
		throw error;
	}
}

function normalizeMode(value: unknown, fallback: SpectraAudioMode): SpectraAudioMode {
	if (value === 'capture') return 'capture';
	if (value === 'webaudio') return 'webaudio';
	if (value === 'bypass') return 'bypass';
	return fallback;
}

const AUDIO_SESSION_PHASE_VALUES: ReadonlySet<string> = new Set([
	'idle',
	'starting',
	'active',
	'stopping',
	'error',
]);

function isAudioSessionPhaseValue(value: unknown): value is AudioSessionPhase {
	return typeof value === 'string' && AUDIO_SESSION_PHASE_VALUES.has(value);
}

/**
 * A phase is a claim about a processor, so it may never be inferred from an
 * unrelated field. The previous fallback returned 'active' for any non-bypass
 * mode, which let a write that simply omitted the phase establish an
 * acknowledged session -- and therefore a Capture badge -- without any processor
 * ever having started.
 *
 * Unknown input now falls back to the caller's own previous phase, and to 'idle'
 * when there is none. It never upgrades the lifecycle.
 */
function resolvePhase(value: unknown, base: AudioSessionSnapshot | null): AudioSessionPhase {
	if (isAudioSessionPhaseValue(value)) return value;
	return base?.phase ?? 'idle';
}

function normalizeLegacyAudioSession(value: LegacyAudioSessionSnapshot): AudioSessionSnapshot | null {
	const actualConfig = normalizeLegacyAudioConfig(value.actualConfig);
	if (!actualConfig) return null;
	const desiredMode = normalizeMode(value.desiredMode, 'bypass');
	const actualMode = normalizeMode(value.actualMode, 'bypass');
	// Legacy snapshots predate the acknowledged-lifecycle contract, so an
	// unreadable phase is downgraded to 'idle' rather than guessed.
	const phase: AudioSessionPhase = actualMode === 'capture'
		? (isAudioSessionPhaseValue(value.phase) ? value.phase : 'idle')
		: value.phase === 'error' ? 'error' : 'idle';
	const normalized: AudioSessionSnapshot = {
		tabId: value.tabId,
		documentId: value.documentId,
		origin: value.origin,
		generation: value.generation,
		desiredMode,
		actualMode,
		phase,
		configRevision: value.configRevision,
		actualConfig,
		lastError: value.lastError,
	};
	return isAudioSessionSnapshot(normalized) ? normalized : null;
}

function normalizeConfig(value: Partial<AudioConfig> | undefined): AudioConfig {
	const config: AudioConfig = {
		...DEFAULT_AUDIO_CONFIG,
		...value,
		eqValues: Array.from(
			{ length: DEFAULT_AUDIO_CONFIG.eqValues.length },
			(_, index) => clampControlValue(
				Number(value?.eqValues?.[index]),
				'eqBand',
				DEFAULT_AUDIO_CONFIG.eqValues[index] ?? 0,
			),
		),
		delay: clampControlValue(Number(value?.delay), 'delay', DEFAULT_AUDIO_CONFIG.delay),
	};
	const storedEffectiveOnly = value?.volume !== undefined
		&& value.volumeBase === undefined
		&& value.boost === undefined;
	const volume = storedEffectiveOnly
		? splitEffectiveVolume(Number(value?.volume))
		: resolveAudioVolume(config);
	return {
		...config,
		volume: compileEffectiveVolume(volume.volumeBase, volume.boost),
		volumeBase: volume.volumeBase,
		boost: volume.boost,
	};
}

async function broadcast(snapshot: AudioSessionSnapshot): Promise<void> {
	const event = createSpectraEvent('spectra.audio.session.changed', snapshot, {
		tabId: snapshot.tabId,
		documentId: snapshot.documentId,
		generation: snapshot.generation,
	});
	await chrome.runtime.sendMessage(event).catch((error: unknown) => {
		// Extension pages are optional receivers; retain the diagnostic without
		// turning their absence or failure into an audio-session failure.
		/* @__PURE__ */ swLog.debug('[AudioSession] Runtime projection was not delivered', error);
	});
}

// Audio-session durability and its UI/runtime projections have different ACK
// boundaries. The projection queue preserves presentation order without letting
// slow receivers block this or the next durable session commit.
export function scheduleAudioSessionProjection(
	tabId: number,
	projection: () => Promise<void>,
): void {
	void projectionSerialized(tabId, projection).catch((error: unknown) => {
		swLog.warn(`[AudioSession] Projection failed for tab ${tabId}`, error);
	});
}

function scheduleBroadcast(snapshot: AudioSessionSnapshot): void {
	scheduleAudioSessionProjection(snapshot.tabId, async () => {
		// A newer queued update supersedes an event that has not started yet.
		if (snapshots.get(snapshot.tabId) !== snapshot
			|| !isCurrentAudioSnapshot(snapshot.tabId, snapshot)) return;
		await broadcast(snapshot);
	});
}

/**
 * Why the most recent write for this tab was refused, or `null` if it was
 * admitted. This is the consumer the rejection codes were missing: a caller can
 * now distinguish "not yet provable" from "never".
 */
export function getAudioSessionRejection(tabId: number): Rejection | null {
	return sessionRejections.get(tabId) ?? snapshots.get(tabId)?.lastRejection ?? null;
}

/**
 * The single admission decision for a session write.
 *
 * Returns a {@link Verdict} rather than a snapshot-or-nothing so that a refusal
 * says which kind it was and what still holds. Every refusal below is raised
 * against an existing session, which is why `base` is non-null on every
 * `reject` path.
 */
function admitAudioSessionUpdate(
	identity: TabSessionIdentity,
	update: {
		config?: Partial<AudioConfig>;
		desiredMode?: unknown;
		actualMode?: unknown;
		phase?: unknown;
		generation?: number;
		error?: string | null;
	},
	base: AudioSessionSnapshot | null,
): Verdict<AudioSessionSnapshot> {
	const rejections: Rejection[] = [];
	if (base && update.generation !== undefined && update.generation < base.generation) {
		return reject({
			code: 'stale_sequence',
			seen: base.generation,
			got: update.generation,
		}, base);
	}
	const actualMode = normalizeMode(update.actualMode, base?.actualMode ?? 'bypass');
	const desiredMode = normalizeMode(update.desiredMode, base?.desiredMode ?? actualMode);
	const lastError: AudioSessionSnapshot['lastError'] = update.error === undefined
		? (base?.lastError ?? null)
		: update.error
			? { code: 'runtime_error', message: update.error, retryable: true }
			: null;
	const claimedPhase = resolvePhase(update.phase, base);
	const phase = reconcileAudioSessionPhase(
		claimedPhase,
		actualMode,
		lastError?.message ?? null,
		base?.phase ?? null,
	);
	// A refused claim is one thing; a claim quietly corrected by the evidence
	// guard is another, and it was invisible before. Recording it is what makes
	// "the store never said active without a processor" observable rather than
	// merely true.
	if (base && phase !== claimedPhase) {
		// The claim was admitted, but only after the evidence guard corrected it.
		// That correction used to be invisible; recording it as a note is what
		// makes "the store never says active without a processor" observable
		// rather than merely true.
		rejections.push({
			code: 'no_evidence',
			missing: phase === 'idle' ? ['actualMode', 'lastError'] : ['lastError'],
		});
	}
	if (base && !shouldAcceptAudioSessionPhase(
		base.generation,
		base.phase,
		update.generation ?? base.generation,
		phase,
	)) {
		return reject({
			code: 'illegal_transition',
			from: base.phase,
			to: phase,
		}, base);
	}
	// A UI intent may be broadcast while a processor is starting/stopping. Keep
	// the last acknowledged config until the owner reports a stable/error phase;
	// otherwise AudioSessionSnapshot would relabel desired values as actual.
	const configUpdate = phase === 'starting' || phase === 'stopping'
		? base?.actualConfig ?? DEFAULT_AUDIO_CONFIG
		: update.config ?? base?.actualConfig;
	const actualConfig = normalizeConfig(configUpdate);
	const previousHash = base ? JSON.stringify(base.actualConfig) : '';
	const nextHash = JSON.stringify(actualConfig);
	const snapshot: AudioSessionSnapshot = {
		...identity,
		// Two sources, one authority: the update is either explicit (already
		// proven monotonic above) or absent, in which case the acknowledged
		// generation stands. A Math.max here would silently paper over a caller
		// that declared a number the guard had just rejected (SP-10).
		generation: update.generation ?? base?.generation ?? 0,
		desiredMode,
		actualMode,
		phase,
		configRevision: (base?.configRevision ?? 0) + (previousHash === nextHash ? 0 : 1),
		actualConfig,
		lastError,
		// Carried on the snapshot because a refusal that stays inside the store
		// cannot be acted on by anything: the UI surface and the Content mirror
		// both read this snapshot, and both should be able to say why a write did
		// not take effect.
		lastRejection: rejections[0] ?? null,
	};
	// An accepted claim that the evidence guard had to correct still carries the
	// correction, so the caller can see that the phase is not the one it asked
	// for rather than silently getting a different answer.
	return accept(snapshot, rejections);
}

export async function updateAudioSession(
	identity: TabSessionIdentity,
	update: {
		config?: Partial<AudioConfig>;
		desiredMode?: unknown;
		actualMode?: unknown;
		phase?: unknown;
		generation?: number;
		error?: string | null;
	},
): Promise<AudioSessionSnapshot> {
	return serialized(identity.tabId, async () => {
		const expectedEpoch = prepareAudioSessionIdentity(identity);
		assertAudioSessionFence(identity, expectedEpoch);
		const previous = await readAudioSession(identity.tabId);
		assertAudioSessionFence(identity, expectedEpoch);
		const sameDocument = previous?.documentId === identity.documentId && previous.origin === identity.origin;
		const base = sameDocument ? previous : null;
		const verdict = admitAudioSessionUpdate(identity, update, base);
		if (!verdict.ok) {
			sessionRejections.set(identity.tabId, verdict.reason);
			// `no_evidence` means the proof had not arrived, so a retry can still
			// succeed. Logging it alongside the settled refusals would make a
			// transient race look like a failure.
			if (!isRetryableRejection(verdict.reason)) {
				swLog.warn(`[AudioSession] Refused tab ${identity.tabId}: ${describeRejection(verdict.reason)}`);
			}
			// Every refusal is raised against an existing session, so the state it
			// declined to change is the answer.
			return verdict.current as AudioSessionSnapshot;
		}
		const snapshot = verdict.state;
		// The public ACK is also restart-recovery authority. Persist the exact
		// identity and stable state before publishing it; a service-worker
		// replacement after the ACK must not observe an older session.
		clearWriteTimer(identity.tabId);
		pendingWrites.delete(identity.tabId);
		retryCounts.delete(identity.tabId);
		assertAudioSessionFence(identity, expectedEpoch);
		await chrome.storage.local.set({ [key(identity.tabId)]: snapshot });
		try {
			assertAudioSessionFence(identity, expectedEpoch);
		} catch (error) {
			await discardFencedAudioSnapshot(identity.tabId, snapshot);
			throw error;
		}
		snapshots.set(identity.tabId, snapshot);
		// The ledger is refusal-only. An admission the evidence guard had to
		// correct still carries that correction on `snapshot.lastRejection`, so
		// "admitted" and "admitted after being changed" stay distinguishable
		// without giving one write two competing owners.
		sessionRejections.delete(identity.tabId);
		try {
			assertAudioSessionFence(identity, expectedEpoch);
		} catch (error) {
			await discardFencedAudioSnapshot(identity.tabId, snapshot);
			throw error;
		}
		// The exact durable snapshot above is the public ACK and worker-restart
		// authority. Runtime delivery is an identity-fenced projection and cannot
		// add readback fidelity to that commit, so it must not delay the caller.
		scheduleBroadcast(snapshot);
		return snapshot;
	});
}

export async function getAudioSession(tabId: number): Promise<AudioSessionSnapshot | null> {
	return serialized(tabId, () => readAudioSession(tabId));
}

async function readAudioSession(tabId: number): Promise<AudioSessionSnapshot | null> {
	const cached = snapshots.get(tabId);
	if (cached) {
		if (!isCurrentAudioSnapshot(tabId, cached)) return null;
		return cached;
	}
	const readEpoch = documentFences.get(tabId)?.epoch;
	const result = await chrome.storage.local.get(key(tabId));
	const stored = result[key(tabId)] as unknown;
	if (isAudioSessionSnapshot(stored)) {
		const normalized = { ...stored, actualConfig: normalizeConfig(stored.actualConfig) };
		if (!isCurrentAudioSnapshot(tabId, normalized, readEpoch)) return null;
		snapshots.set(tabId, normalized);
		const fence = documentFences.get(tabId);
		if (fence && !fence.currentDocumentId) fence.currentDocumentId = normalized.documentId;
		return normalized;
	}
	if (!isLegacyAudioSessionSnapshot(stored)) return null;
	const normalized = normalizeLegacyAudioSession(stored);
	if (!normalized) return null;
	if (!isCurrentAudioSnapshot(tabId, normalized, readEpoch)) return null;
	await chrome.storage.local.set({ [key(tabId)]: normalized });
	if (!isCurrentAudioSnapshot(tabId, normalized, readEpoch)) {
		await chrome.storage.local.remove(key(tabId)).catch(() => undefined);
		return null;
	}
	snapshots.set(tabId, normalized);
	const fence = documentFences.get(tabId);
	if (fence && !fence.currentDocumentId) fence.currentDocumentId = normalized.documentId;
	return normalized;
}

export async function removeAudioSession(
	tabId: number,
	options: { alreadyFenced?: boolean } = {},
): Promise<void> {
	if (!options.alreadyFenced) fenceAudioSession(tabId);
	await serialized(tabId, async () => {
		snapshots.delete(tabId);
		clearWriteTimer(tabId);
		pendingWrites.delete(tabId);
		retryCounts.delete(tabId);
		await chrome.storage.local.remove(key(tabId));
	});
}

export function isAudioSessionIdentityInvalidated(identity: TabSessionIdentity): boolean {
	const fence = documentFences.get(identity.tabId);
	if (!fence) return false;
	return fence.awaitingDocument
		|| fence.retiredDocumentId === identity.documentId
		|| (fence.currentDocumentId !== null && fence.currentDocumentId !== identity.documentId);
}

// post: tab teardown releases the bounded lifecycle record as no document from that tab can reply again
export async function forgetAudioSession(
	tabId: number,
	options: { alreadyFenced?: boolean } = {},
): Promise<void> {
	if (!options.alreadyFenced) fenceAudioSession(tabId);
	await serialized(tabId, async () => {
		snapshots.delete(tabId);
		clearWriteTimer(tabId);
		pendingWrites.delete(tabId);
		retryCounts.delete(tabId);
		await chrome.storage.local.remove(key(tabId));
		documentFences.delete(tabId);
	});
}

export const audioSessionTestApi = {
	lifecycleEpoch: (tabId: number) => documentFences.get(tabId)?.epoch ?? 0,
	lifecycleCount: () => documentFences.size,
};

export async function flushAudioSessions(tabId?: number): Promise<void> {
	if (tabId !== undefined) {
		await serialized(tabId, () => flushAudioSessionInternal(tabId));
		// The authority barrier above guarantees every earlier update has scheduled
		// its presentation. This second owner-specific barrier then settles those
		// projections without putting them back on the authority path.
		await projectionSerialized(tabId, async () => undefined);
		return;
	}
	await Promise.all([...pendingWrites.keys()].map((pendingTabId) => (
		serialized(pendingTabId, () => flushAudioSessionInternal(pendingTabId))
	)));
	// First settle all authority operations: each one schedules its projection
	// before completing. Then settle projection-only work, which intentionally has
	// no pending storage entry.
	await serialized.drain();
	await projectionSerialized.drain();
}
