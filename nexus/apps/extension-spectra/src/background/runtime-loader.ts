// goal: single-flight, document-scoped loader for the optional heavy content runtime

import {
	controlCapabilityUsesStrategy,
	createBoundedSet,
	isDefaultAudioConfig,
	resolveAudioVolume,
	rpcFailure,
	rpcSuccess,
	selectControlCapabilityScope,
	SPECTRA_CONTENT_RUNTIME_REVISION,
	SPECTRA_PROTOCOL_VERSION,
	type AudioConfig,
	type ContentRuntimeLeaseReason,
	type ContentRuntimeReadyResult,
	type ContentRuntimeSourceOwnership,
	type ContentRuntimeStatus,
	type ControlField,
	type ControlPatch,
	type ControlSessionPatch,
	type HotkeySettings,
	type MediaTarget,
	type SpectraResponse,
} from '@nexus/contracts';
import { createSettlementPool, observeWithin } from '@nexus/kernel';
import { swLog } from '../shared/logger';
import { injectMainBridges } from './main-runtime-manager';
import { settingsRepository } from './settings-repository';
import { storage } from './state';
const PROTO_RUNTIME_BOOTSTRAP_HELLO = 'spectra.content.bootstrap.hello' as const;
const PROTO_RUNTIME_ENSURE = 'spectra.content.runtime.ensure' as const;
const PROTO_RUNTIME_IDENTITY = 'spectra.content.runtime.identity' as const;
const PROTO_RUNTIME_READY = 'spectra.content.runtime.ready' as const;
const PROTO_RUNTIME_RELEASE = 'spectra.content.runtime.release' as const;

import { ensureCaptureStatesReconciled } from './handlers/capture';
import {
	forgetDocumentSiteHotkeys,
	reconcileDocumentSiteHotkeys,
	resetDocumentSiteHotkeysForTests,
} from './site-hotkey-loader-adapter';
import { forEachBounded } from './bounded-fanout';
import { isContentDocumentUrl } from './content-document-url';
import { submitControlRequest } from './control-coordinator';
import { isBackgroundRequestEnvelope, sendBackgroundTabRequestOnce, RPC_INVALID_REQUEST } from './background-rpc';

// Heavy SPA startup can legitimately spend several seconds restoring settings
// and discovering media before the runtime publishes READY. Keep the handshake
// bounded, but do not classify a normal cold start as a failed injection.
const READY_TIMEOUT_MS = 15_000;

interface RuntimeWaiter {
	resolve(result: ContentRuntimeReadyResult): void;
	reject(error: Error): void;
	timeoutId: ReturnType<typeof setTimeout>;
}

const readyDocuments = new Map<string, ContentRuntimeReadyResult>();
const loadingDocuments = new Map<string, Promise<ContentRuntimeReadyResult>>();
const disposingDocuments = new Map<string, Promise<void>>();
const waiters = new Map<string, RuntimeWaiter>();
/**
 * Keys retired by a navigation or tab close. Two awaits inside
 * `ensureContentRuntime` can outlive the document they started under, and a
 * lease written after `forgetDocument` has no owner left to release it — the
 * runtime then never disposes (SP-55). Bounded: a tab navigates finitely often,
 * and the oldest entry is the one least likely to still be in flight.
 */
const retiredRuntimeKeys = createBoundedSet<string>({ cap: 256, ttlMs: 300_000 });
const leases = new Map<string, Set<string>>();
// A same-document release defeats older status replies. Only a new confirmed
// intent clears this decision; navigation/tab removal retires it with the key.
const releasedMediaIntents = new Set<string>();
const disposeTimers = new Map<string, ReturnType<typeof setTimeout>>();
interface DocumentInitialization {
	operation: Promise<void>;
	url: string | undefined;
	phase: 'running' | 'deferred' | 'complete';
	wakePending: boolean;
}
const documentInitializations = new Map<string, DocumentInitialization>();
let initialized = false;

const RUNTIME_HANDOFF_GRACE_MS = 250;
const RUNTIME_PROBE_TIMEOUT_MS = 1_000;
const RUNTIME_PROBE_CONCURRENCY = 8;
let runtimeProbes = createSettlementPool<string, SpectraResponse<'spectra.content.runtime.status'>>(RUNTIME_PROBE_CONCURRENCY);

export function getRuntimeLoaderDiagnostics(): Record<string, number> {
	return { runtimeProbePendingCount: runtimeProbes.pendingCount,
		runtimeLoadingCount: loadingDocuments.size, runtimeReadyWaiterCount: waiters.size,
		runtimeReadyDocumentCount: readyDocuments.size, runtimeDisposingCount: disposingDocuments.size };
}

function runtimeKey(tabId: number, documentId: string): string {
	return `${tabId}:${documentId}`;
}

function runtimeLeaseKey(reason: ContentRuntimeLeaseReason, capability: string): string {
	return `${reason}:${capability}`;
}

function canReleaseRuntimeConsumer(sender: chrome.runtime.MessageSender): boolean {
	if (!sender.tab) return true;
	return sender.id === chrome.runtime.id
		&& typeof sender.url === 'string'
		&& sender.url.startsWith(chrome.runtime.getURL(''));
}

export async function reconcileHotkeyRuntimeLease(
	tabId: number,
	documentId: string,
	url: string | undefined,
	settings?: HotkeySettings,
): Promise<void> {
	const hotkeys = settings ?? (await settingsRepository.getSnapshot()).hotkeySettings;
	await reconcileDocumentSiteHotkeys(tabId, documentId, url, hotkeys, {
		ensure: async (capability) => {
			const ready = await ensureContentRuntime(tabId, documentId, 'hotkey', capability);
			if (ready.documentId !== documentId) {
				releaseContentRuntimeLease(tabId, ready.documentId, 'hotkey', capability);
				throw new Error('Site-hotkey full runtime resolved to a stale document');
			}
		},
		release: (capability) => {
			releaseContentRuntimeLease(tabId, documentId, 'hotkey', capability);
		},
	});
}

export async function reconcileAllHotkeyRuntimeLeases(
	settings: HotkeySettings,
	knownTabs?: readonly chrome.tabs.Tab[],
): Promise<void> {
	const tabs = knownTabs ?? await chrome.tabs.query({});
	await forEachBounded(tabs, 8, async (tab) => {
		if (!tab.id || !tab.url || !isContentDocumentUrl(tab.url)) return;
		const documentId = await currentTopDocumentId(tab.id);
		await reconcileHotkeyRuntimeLease(tab.id, documentId, tab.url, settings);
	});
}

function sourceLeaseCapability(kind: 'marker' | 'ab', target: MediaTarget): string {
	return `owner:${kind}:${target.mediaId.slice(0, 64)}:${target.sourceRevision}`;
}

function acquireRuntimeLease(
	key: string,
	reason: ContentRuntimeLeaseReason,
	capability: string,
): void {
	const timer = disposeTimers.get(key);
	if (timer) clearTimeout(timer);
	disposeTimers.delete(key);
	// A fresh lease re-establishes the document as current, so a later retirement
	// of the same key must be a new decision rather than a stale one.
	retiredRuntimeKeys.delete(key);
	const active = leases.get(key) ?? new Set<string>();
	active.add(runtimeLeaseKey(reason, capability));
	leases.set(key, active);
}

export function retainSourceRuntimeLease(
	tabId: number,
	target: MediaTarget,
	kind: 'marker' | 'ab',
): void {
	acquireRuntimeLease(
		runtimeKey(tabId, target.documentId),
		'control',
		sourceLeaseCapability(kind, target),
	);
}

export const MEDIA_INTENT_RUNTIME_CAPABILITY = 'document-media-intent';
// Observation is a reason to own a document runtime in its own right. It carries
// no desired values: a page-native volume/rate change must reach the canonical
// snapshot even when the tab has never authored a preference.
export const DOCUMENT_OBSERVATION_CAPABILITY = 'document-media-observation';

// This lease owns the executor's document template, not any current source's
// physical field. A rejected live speed or page observation cannot release it.
export function retainMediaIntentRuntimeLease(tabId: number, documentId: string): void {
	const key = runtimeKey(tabId, documentId);
	releasedMediaIntents.delete(key);
	acquireRuntimeLease(key, 'restore', MEDIA_INTENT_RUNTIME_CAPABILITY);
}

export function releaseMediaIntentRuntimeLease(tabId: number, documentId: string): void {
	releasedMediaIntents.add(runtimeKey(tabId, documentId));
	releaseContentRuntimeLease(tabId, documentId, 'restore', MEDIA_INTENT_RUNTIME_CAPABILITY);
}

function recoverMediaIntentRuntimeLease(tabId: number, documentId: string): void {
	const key = runtimeKey(tabId, documentId);
	if (retiredRuntimeKeys.has(key) || releasedMediaIntents.has(key)) return;
	acquireRuntimeLease(key, 'restore', MEDIA_INTENT_RUNTIME_CAPABILITY);
}

export function releaseSourceRuntimeLease(
	tabId: number,
	target: MediaTarget,
	kind: 'marker' | 'ab',
): void {
	releaseContentRuntimeLease(
		tabId,
		target.documentId,
		'control',
		sourceLeaseCapability(kind, target),
	);
}

function recoverSourceRuntimeLeases(
	tabId: number,
	documentId: string,
	ownedSources: readonly ContentRuntimeSourceOwnership[],
): void {
	for (const owned of ownedSources) {
		if (owned.target.documentId !== documentId) continue;
		if (owned.markerCount > 0) retainSourceRuntimeLease(tabId, owned.target, 'marker');
		if (owned.abActive) retainSourceRuntimeLease(tabId, owned.target, 'ab');
	}
}

async function disposeDocumentRuntime(
	tabId: number,
	documentId: string,
	key: string,
): Promise<void> {
	if ((leases.get(key)?.size ?? 0) > 0) return;
	const ready = readyDocuments.get(key);
	if (!ready) return;
	const response = await sendBackgroundTabRequestOnce(
		tabId,
		PROTO_RUNTIME_RELEASE,
		{ runtimeRevision: ready.runtimeRevision },
		{ documentId },
	).catch(() => null);
	// A missing RELEASE ACK is an ambiguous outcome: the document may already
	// have disposed the runtime even though the response was lost. Never keep a
	// READY cache entry after that boundary. The next consumer probes the
	// document and either reuses a still-live runtime or performs a fresh
	// injection, so a transient messaging failure cannot hand out a dead host.
	if (readyDocuments.get(key)?.runtimeRevision === ready.runtimeRevision) {
		readyDocuments.delete(key);
	}
	if (response && !response.ok) {
		swLog.warn(`[Runtime] release was not acknowledged: ${response.error.code}`);
	}
}

function beginDocumentRuntimeDisposal(
	tabId: number,
	documentId: string,
	key: string,
): Promise<void> {
	const existing = disposingDocuments.get(key);
	if (existing) return existing;
	const operation = disposeDocumentRuntime(tabId, documentId, key)
		.finally(() => {
			if (disposingDocuments.get(key) === operation) disposingDocuments.delete(key);
		});
	disposingDocuments.set(key, operation);
	return operation;
}

export function releaseContentRuntimeLease(
	tabId: number,
	documentId: string,
	reason: ContentRuntimeLeaseReason,
	capability: string,
): void {
	const key = runtimeKey(tabId, documentId);
	const active = leases.get(key);
	if (!active?.delete(runtimeLeaseKey(reason, capability))) return;
	if (active && active.size > 0) return;
	leases.delete(key);
	const previous = disposeTimers.get(key);
	if (previous) clearTimeout(previous);
	disposeTimers.set(key, setTimeout(() => {
		disposeTimers.delete(key);
		void beginDocumentRuntimeDisposal(tabId, documentId, key)
			.catch((error) => swLog.warn(`[Runtime] release failed: ${String(error)}`));
	}, RUNTIME_HANDOFF_GRACE_MS));
}

// post: reports whether the runtime still holds the given lease. A held lease
// both proves the runtime is alive (disposal only starts at zero leases) and
// that the owning consumer already passed the readiness barrier, so consumers
// may skip a redundant re-ensure for the same document.
export function hasRuntimeLease(
	tabId: number,
	documentId: string,
	reason: ContentRuntimeLeaseReason,
	capability: string,
): boolean {
	return leases.get(runtimeKey(tabId, documentId))
		?.has(runtimeLeaseKey(reason, capability)) ?? false;
}

function senderIdentity(sender: chrome.runtime.MessageSender): { tabId: number; documentId: string } | null {
	const tabId = sender.tab?.id;
	if (!tabId || sender.frameId !== 0 || !sender.documentId?.trim()) return null;
	return { tabId, documentId: sender.documentId };
}

async function currentTopDocument(tabId: number): Promise<{ documentId: string; url: string }> {
	const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
	if (!frame?.documentId) throw new Error('The tab has no current top-level document');
	if (!frame.url) throw new Error('The tab has no current top-level URL');
	return { documentId: frame.documentId, url: frame.url };
}

async function currentTopDocumentId(tabId: number): Promise<string> {
	return (await currentTopDocument(tabId)).documentId;
}

async function resolveDocumentId(tabId: number, requested?: string): Promise<string> {
	const current = await currentTopDocumentId(tabId);
	if (requested && requested !== current) throw new Error('The requested document is stale');
	return current;
}

type DocumentRestore = (tabId: number, documentId: string, url: string | undefined) => Promise<void>;
let restoreDocumentForInitialization: DocumentRestore = (...args) => restoreIfConfigured(...args);

function beginDocumentInitialization(
	tabId: number,
	documentId: string,
	url: string | undefined,
): Promise<void> {
	const key = runtimeKey(tabId, documentId);
	const existing = documentInitializations.get(key);
	if (retiredRuntimeKeys.has(key) || releasedMediaIntents.has(key)) return Promise.resolve();
	if (existing && existing.phase !== 'deferred') return existing.operation;
	const entry: DocumentInitialization = { operation: Promise.resolve(), url, phase: 'running', wakePending: false };
	entry.operation = Promise.resolve()
		.then(() => restoreDocumentForInitialization(tabId, documentId, url))
		.then(() => { entry.phase = 'complete'; })
		.catch((error) => {
			// Releasing the ordering barrier does not complete the restore duty.
			// A later real lifecycle signal can resume this exact document, without
			// requiring a user gesture or starting a polling/retry owner.
			entry.phase = 'deferred';
			swLog.warn(`[Runtime] document restore failed: ${String(error)}`);
		}).finally(() => {
			if (entry.phase === 'deferred' && entry.wakePending && documentInitializations.get(key) === entry) {
				resumeDocumentInitialization(tabId, documentId, entry.url);
			}
		});
	documentInitializations.set(key, entry);
	return entry.operation;
}

// Only admitted lifecycle facts call this; READY/restore writes do not wake
// their own initializer. Coalesce a signal that arrives before failure settles.
export function resumeDocumentInitialization(tabId: number, documentId: string, url: string | undefined): void {
	const key = runtimeKey(tabId, documentId);
	if (!initialized || retiredRuntimeKeys.has(key) || releasedMediaIntents.has(key)) return;
	const existing = documentInitializations.get(key);
	if (existing?.phase === 'running') {
		if (url) existing.url = url;
		existing.wakePending = true;
		return;
	}
	const resourceUrl = url ?? existing?.url;
	if (resourceUrl) void beginDocumentInitialization(tabId, documentId, resourceUrl);
}

// post: explicit control and initial snapshot reads observe one completed
// restore decision for the current document. Restore-originated writes bypass
// this function in the coordinator, preventing a self-wait cycle.
export async function awaitDocumentInitialization(
	tabId: number,
	documentId?: string,
): Promise<void> {
	// Direct unit consumers of the coordinator do not initialize the MV3 loader.
	// Production does so first in background/index.ts.
	if (!initialized) return;
	const current = await currentTopDocument(tabId);
	if (documentId && documentId !== current.documentId) {
		throw new Error('The requested initialization document is stale');
	}
	await beginDocumentInitialization(tabId, current.documentId, current.url);
}

async function probeRuntime(tabId: number, documentId: string): Promise<{
	ready: ContentRuntimeReadyResult;
	mediaIntentState: ContentRuntimeStatus['mediaIntentState'];
	ownedSources: ContentRuntimeSourceOwnership[];
} | null> {
	const operation = runtimeProbes.getOrStart(runtimeKey(tabId, documentId), () => sendBackgroundTabRequestOnce(
		tabId,
		'spectra.content.runtime.status',
		{},
		{ documentId },
	));
	// This optional read must not prevent the injection/READY transaction from
	// starting. Keep its physical permit until it settles; expired observations
	// cannot restore source leases or overwrite the newer READY authority.
	if (!operation) return null;
	const observed = await observeWithin(operation, RUNTIME_PROBE_TIMEOUT_MS).catch(() => null);
	const response = observed?.settled ? observed.value : null;
	if (!response?.ok
		|| !response.data.ready
		|| response.data.runtimeRevision !== SPECTRA_CONTENT_RUNTIME_REVISION) return null;
	return {
		ready: { documentId, runtimeRevision: response.data.runtimeRevision, ready: true },
		mediaIntentState: response.data.mediaIntentState,
		ownedSources: response.data.ownedSources,
	};
}

function createReadyWaiter(key: string): Promise<ContentRuntimeReadyResult> {
	return new Promise((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			waiters.delete(key);
			reject(new Error('Content runtime READY handshake timed out'));
		}, READY_TIMEOUT_MS);
		waiters.set(key, { resolve, reject, timeoutId });
	});
}

function commitReady(tabId: number, documentId: string, runtimeRevision: string): ContentRuntimeReadyResult {
	const key = runtimeKey(tabId, documentId);
	const result: ContentRuntimeReadyResult = { documentId, runtimeRevision, ready: true };
	readyDocuments.set(key, result);
	const waiter = waiters.get(key);
	if (waiter) {
		clearTimeout(waiter.timeoutId);
		waiters.delete(key);
		waiter.resolve(result);
	}
	return result;
}

function forgetDocument(tabId: number, documentId?: string): void {
	forgetDocumentSiteHotkeys(tabId, documentId);
	const prefix = `${tabId}:`;
	// Build the retirement set before dropping the maps: after this point the
	// keys are gone and nothing else can tell an in-flight step that its
	// document no longer exists.
	for (const map of [readyDocuments, loadingDocuments, disposingDocuments, leases, documentInitializations, releasedMediaIntents]) {
		for (const key of map.keys()) {
			if (!key.startsWith(prefix)) continue;
			if (documentId && key !== runtimeKey(tabId, documentId)) continue;
			retiredRuntimeKeys.add(key);
		}
	}
	if (documentId) retiredRuntimeKeys.add(runtimeKey(tabId, documentId));
	for (const key of [...readyDocuments.keys()]) {
		if (key.startsWith(prefix) && (!documentId || key === runtimeKey(tabId, documentId))) {
			readyDocuments.delete(key);
		}
	}
	for (const [key, waiter] of [...waiters.entries()]) {
		if (!key.startsWith(prefix) || documentId && key !== runtimeKey(tabId, documentId)) continue;
		clearTimeout(waiter.timeoutId);
		waiters.delete(key);
		waiter.reject(new Error('Content runtime document was released'));
	}
	for (const key of [...loadingDocuments.keys()]) {
		if (key.startsWith(prefix) && (!documentId || key === runtimeKey(tabId, documentId))) {
			loadingDocuments.delete(key);
		}
	}
	for (const key of [...disposingDocuments.keys()]) {
		if (key.startsWith(prefix) && (!documentId || key === runtimeKey(tabId, documentId))) {
			disposingDocuments.delete(key);
		}
	}
	for (const key of [...leases.keys()]) {
		if (key.startsWith(prefix) && (!documentId || key === runtimeKey(tabId, documentId))) {
			leases.delete(key);
		}
	}
	for (const key of releasedMediaIntents) {
		if (key.startsWith(prefix) && (!documentId || key === runtimeKey(tabId, documentId))) releasedMediaIntents.delete(key);
	}
	for (const [key, timer] of [...disposeTimers.entries()]) {
		if (!key.startsWith(prefix) || documentId && key !== runtimeKey(tabId, documentId)) continue;
		clearTimeout(timer);
		disposeTimers.delete(key);
	}
	for (const key of [...documentInitializations.keys()]) {
		if (key.startsWith(prefix) && (!documentId || key === runtimeKey(tabId, documentId))) {
			documentInitializations.delete(key);
		}
	}
}

async function loadRuntime(tabId: number, documentId: string): Promise<ContentRuntimeReadyResult> {
	const key = runtimeKey(tabId, documentId);
	const waitForReady = createReadyWaiter(key);
	try {
		const inject = () => chrome.scripting.executeScript({
			target: { tabId, documentIds: [documentId] },
			files: ['content-runtime.js'],
			world: 'ISOLATED',
			// A lease already authorizes work in this exact document. Waiting for
			// document_idle makes the first control depend on unrelated page loads.
			injectImmediately: true,
		});
		const waitForInjection = inject().catch(async (error: unknown) => {
			const message = error instanceof Error ? error.message : String(error);
			if (message.includes('Could not load file')) {
				await new Promise((resolveWait) => setTimeout(resolveWait, 50));
				return inject();
			}
			throw error;
		});
		const first = await Promise.race([
			waitForReady.then((result) => ({ kind: 'ready' as const, result })),
			waitForInjection.then(() => ({ kind: 'injected' as const })),
		]);
		return first.kind === 'ready' ? first.result : await waitForReady;
	} catch (error) {
		const waiter = waiters.get(key);
		if (waiter) {
			clearTimeout(waiter.timeoutId);
			waiters.delete(key);
		}
		throw error;
	}
}

async function ensureReadyDocument(
	tabId: number,
	documentId: string,
): Promise<ContentRuntimeReadyResult> {
	const key = runtimeKey(tabId, documentId);
	const pending = loadingDocuments.get(key);
	if (pending) return pending;
	let loading!: Promise<ContentRuntimeReadyResult>;
	loading = (async () => {
		const known = readyDocuments.get(key);
		if (known?.runtimeRevision === SPECTRA_CONTENT_RUNTIME_REVISION) return known;

		const probed = await probeRuntime(tabId, documentId);
		assertStillLoading(key, loading);
		if (probed) {
			// A navigation during the probe retires the document. Writing its READY
			// entry afterwards would hand the next consumer a runtime for a document
			// that no longer exists, and nothing would ever release it.
			recoverSourceRuntimeLeases(tabId, documentId, probed.ownedSources);
			if (probed.mediaIntentState === 'retained') recoverMediaIntentRuntimeLease(tabId, documentId);
			readyDocuments.set(key, probed.ready);
			return probed.ready;
		}
		return loadRuntime(tabId, documentId);
	})()
		// Only the promise that owns the slot may clear it. A navigation during
		// loading lets a fresh `ensureReadyDocument` install its own promise; the
		// old one finishing later must not delete the new owner (SP-55).
		.finally(() => {
			if (loadingDocuments.get(key) === loading) loadingDocuments.delete(key);
		});
	loadingDocuments.set(key, loading);
	return loading;
}

/**
 * In-flight loader steps are only authoritative while they still own the
 * `loadingDocuments` slot. `forgetDocument` removes that slot, so this check is
 * exactly the "was this document retired while I awaited" question.
 */
function assertStillLoading(key: string, loading: Promise<ContentRuntimeReadyResult>): void {
	if (loadingDocuments.get(key) !== loading) {
		throw new Error('Content runtime document was released during loading');
	}
}

export async function ensureContentRuntime(
	tabId: number,
	documentId: string | undefined,
	reason: ContentRuntimeLeaseReason,
	capability: string,
): Promise<ContentRuntimeReadyResult> {
	// A restarted worker must reconcile the surviving offscreen Capture owner
	// before Content hydrates or reuses READY. Otherwise a remote/hotkey/restore
	// intent can observe a temporary bypass and misclassify an update to the
	// existing processor as a forbidden new Capture request.
	await ensureCaptureStatesReconciled();
	const currentDocumentId = await resolveDocumentId(tabId, documentId);
	const key = runtimeKey(tabId, currentDocumentId);
	// Resolving the document is an await, so the tab may have navigated while it
	// was pending. Leasing a retired document creates a lease that no
	// `forgetDocument` will ever see again.
	if (retiredRuntimeKeys.has(key)) {
		throw new Error('Content runtime document was retired before its lease was acquired');
	}
	if (reason === 'restore' && capability === MEDIA_INTENT_RUNTIME_CAPABILITY && releasedMediaIntents.has(key)) {
		throw new Error('Document media template was released before its recovery lease was acquired');
	}
	acquireRuntimeLease(key, reason, capability);
	try {
		// A lease acquired while the last consumer is awaiting its RELEASE ACK
		// must reload after that handshake. Returning the old READY entry would
		// otherwise hand a new caller a runtime that is being torn down.
		await disposingDocuments.get(key);
		return await ensureReadyDocument(tabId, currentDocumentId);
	} catch (error) {
		releaseContentRuntimeLease(tabId, currentDocumentId, reason, capability);
		throw error;
	}
}

/**
 * A document that reports playable media must be observed. Observation is not a
 * consequence of a restore patch: a live route that inherits no desired values
 * still has a page-native volume/rate surface, and without an owner every later
 * gesture or surface has to cold-start the runtime with an explicit read.
 *
 * The first report of a redirected route can arrive while this worker is still
 * resolving which document the tab now owns; a stale identity rejects the
 * ensure. Ownership is an obligation, so a bounded retry converges on its own
 * instead of waiting for a later report, a pause/play, or the Popup.
 */
const MEDIA_OBSERVATION_RETRY_DELAYS_MS = [120, 400, 1_200, 3_000, 6_000, 10_000] as const;
const mediaObservationLoads = new Map<string, Promise<void>>();
// A retry chain can outlive a test reset. The generation token retires it
// instead of letting a delayed attempt load a runtime into the next harness.
let loaderGeneration = 0;

export function ensureMediaObservation(tabId: number, documentId: string): Promise<void> {
	const key = runtimeKey(tabId, documentId);
	if (retiredRuntimeKeys.has(key) || releasedMediaIntents.has(key)) return Promise.resolve();
	const pending = mediaObservationLoads.get(key);
	if (pending) return pending;
	const load = ensureMediaObservationWithRetry(tabId, documentId, key);
	mediaObservationLoads.set(key, load);
	void load.catch(() => undefined).finally(() => {
		if (mediaObservationLoads.get(key) === load) mediaObservationLoads.delete(key);
	});
	return load;
}

async function ensureMediaObservationWithRetry(
	tabId: number,
	documentId: string,
	key: string,
): Promise<void> {
	const generation = loaderGeneration;
	for (let attempt = 0; ; attempt += 1) {
		try {
			await ensureContentRuntime(tabId, documentId, 'observation', DOCUMENT_OBSERVATION_CAPABILITY);
			return;
		} catch (error) {
			if (attempt >= MEDIA_OBSERVATION_RETRY_DELAYS_MS.length || generation !== loaderGeneration
				|| retiredRuntimeKeys.has(key) || releasedMediaIntents.has(key)) throw error;
			await new Promise((resolve) => setTimeout(resolve, MEDIA_OBSERVATION_RETRY_DELAYS_MS[attempt]));
			if (generation !== loaderGeneration
				|| retiredRuntimeKeys.has(key) || releasedMediaIntents.has(key)) throw error;
		}
	}
}

async function recoverFailedRestoreLease(tabId: number, documentId: string): Promise<boolean> {
	const surviving = await probeRuntime(tabId, documentId);
	const key = runtimeKey(tabId, documentId);
	if (await currentTopDocumentId(tabId).catch(() => null) !== documentId
		|| retiredRuntimeKeys.has(key) || releasedMediaIntents.has(key)) return false;
	// An unavailable probe is not proof that the owned recovery template is
	// absent. Keep only an already-held lease; do not invent one from unknown.
	if (!surviving) return hasRuntimeLease(tabId, documentId, 'restore', MEDIA_INTENT_RUNTIME_CAPABILITY);
	if (surviving.mediaIntentState !== 'retained') return false;
	recoverMediaIntentRuntimeLease(tabId, documentId);
	return true;
}

async function restoreIfConfigured(tabId: number, documentId: string, url: string | undefined): Promise<void> {
	if (!url) return;
	let identity: ReturnType<typeof storage.tabSession.identity>;
	try {
		identity = storage.tabSession.identity(tabId, documentId, url);
	} catch { return; }
	const surviving = await probeRuntime(tabId, documentId);
	if (retiredRuntimeKeys.has(runtimeKey(tabId, documentId))) throw new Error('Restore document was retired during its probe');
	if (surviving?.mediaIntentState === 'retained' || surviving?.mediaIntentState === 'released') {
		// Same-document worker restart must preserve the executor's explicit
		// template or release decision. A resource actual of 1x is neither.
		if (surviving.mediaIntentState === 'retained') recoverMediaIntentRuntimeLease(tabId, documentId);
		return;
	}
	const restore = await resolveDocumentRestorePlan(
		tabId,
		documentId,
		identity.resourceUrl,
	);
	if (Object.keys(restore.patch).length === 0) return;
	const capability = MEDIA_INTENT_RUNTIME_CAPABILITY;
	await ensureContentRuntime(tabId, documentId, 'restore', capability);
	let retained = false;
	try {
		for (const group of splitDocumentRestorePatch(restore.patch)) {
			await submitControlRequest({
				tabId,
				source: 'restore',
				requestedCoverage: group.requestedCoverage,
				target: null,
				patch: group.patch,
			});
		}
		// A non-empty document restore is a live desired-state owner, not a
		// one-shot write. Retain the event-driven runtime so media created later
		// by an SPA can consume the same revision on registration/metadata/play.
		retained = true;
	} catch (error) {
		// A rejected source ACK can still leave a legitimate document template
		// in Content. Its event-driven continuation needs the existing lease.
		// Probe exact physical ownership; a late answer cannot undo user release.
		retained = await recoverFailedRestoreLease(tabId, documentId);
		throw error;
	} finally {
		if (!retained) {
			releaseContentRuntimeLease(tabId, documentId, 'restore', capability);
		}
	}
}

export function initializeContentRuntimeLoader(): void {
	if (initialized) return;
	initialized = true;
	void settingsRepository.getSnapshot()
		.then((snapshot) => reconcileAllHotkeyRuntimeLeases(snapshot.hotkeySettings))
		.catch((error) => swLog.warn(`[Runtime] startup hotkey projection failed: ${String(error)}`));

	chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
		if (!message || typeof message !== 'object') return false;
		const candidate = message as { protocolVersion?: unknown; type?: unknown };
		const isRuntimeMessage = candidate.type === PROTO_RUNTIME_BOOTSTRAP_HELLO
			|| candidate.type === PROTO_RUNTIME_IDENTITY
			|| candidate.type === PROTO_RUNTIME_ENSURE
			|| candidate.type === PROTO_RUNTIME_READY
			|| candidate.type === PROTO_RUNTIME_RELEASE;
		if (candidate.protocolVersion !== SPECTRA_PROTOCOL_VERSION || !isRuntimeMessage) return false;
		if (sender.id !== chrome.runtime.id) {
			sendResponse(rpcFailure('forbidden', 'Content runtime RPC is extension-internal only'));
			return false;
		}
		if (!isBackgroundRequestEnvelope(message)
			|| (message.type !== PROTO_RUNTIME_BOOTSTRAP_HELLO
				&& message.type !== PROTO_RUNTIME_IDENTITY
				&& message.type !== PROTO_RUNTIME_ENSURE
				&& message.type !== PROTO_RUNTIME_READY
				&& message.type !== PROTO_RUNTIME_RELEASE)) {
			sendResponse(rpcFailure(RPC_INVALID_REQUEST, 'Malformed content runtime request'));
			return false;
		}

		if (message.type === PROTO_RUNTIME_IDENTITY) {
			const identity = senderIdentity(sender);
			if (!identity) {
				sendResponse(rpcFailure(
					'forbidden',
					'Content runtime identity requires a top-level document sender',
				));
				return false;
			}
			// Chrome's MessageSender is the only identity authority. Content cannot
			// supply, cache, or retag this value across a navigation. The sender tuple
			// is still checked against the current top document before it can create a
			// DocumentRuntimeContext; READY is intentionally a second fence.
			void currentTopDocumentId(identity.tabId).then(
				(currentDocumentId) => sendResponse(currentDocumentId === identity.documentId
					? rpcSuccess({ documentId: identity.documentId, frameId: 0 as const })
					: rpcFailure('stale_document', 'Content identity belongs to a stale document')),
				(error) => sendResponse(rpcFailure(
					'runtime_identity_unavailable',
					error instanceof Error ? error.message : String(error),
					true,
				)),
			);
			return true;
		}

		if (message.type === PROTO_RUNTIME_BOOTSTRAP_HELLO) {
			const identity = senderIdentity(sender);
			if (!identity) {
				sendResponse(rpcFailure('forbidden', 'Bootstrap HELLO requires a document identity'));
				return false;
			}
			// rule: SCTRL-001/004 — the manifest registers the minimal ISOLATED
			// bootstrap and the two closed MAIN-world bridges. This recovery path
			// re-injects fullscreen V1 and exact-element page-media V2 idempotently on
			// every new document, delegated exclusively to
			// main-runtime-manager (sole owner of the MAIN-world injection literal).
			// This ensures the bridges are present from the very first event the
			// page dispatches.
			void injectMainBridges(identity.tabId).catch((error: unknown) => {
				swLog.warn(
					`[Runtime] MAIN bridge injection failed for tab ${identity.tabId}: `
					+ `${error instanceof Error ? error.message : String(error)}`,
				);
			});
			const initialization = beginDocumentInitialization(
				identity.tabId,
				identity.documentId,
				sender.url ?? sender.tab?.url,
			);
			const hotkeyProjection = reconcileHotkeyRuntimeLease(
				identity.tabId,
				identity.documentId,
				sender.url ?? sender.tab?.url,
			);
			void Promise.allSettled([initialization, hotkeyProjection]).then((results) => {
				for (const result of results) {
					if (result.status === 'rejected') swLog.warn(`[Runtime] bootstrap projection failed: ${String(result.reason)}`);
				}
			});
			void initialization.then(() => {
				const known = readyDocuments.get(runtimeKey(identity.tabId, identity.documentId));
				sendResponse(rpcSuccess({
					accepted: true as const,
					runtimeRevision: known?.runtimeRevision ?? null,
				}));
			}, (error) => sendResponse(rpcFailure(
				'content_initialization_failed',
				error instanceof Error ? error.message : String(error),
				true,
			)));
			return true;
		}

		if (message.type === PROTO_RUNTIME_ENSURE) {
			void ensureContentRuntime(
				message.payload.tabId,
				message.payload.documentId,
				message.payload.reason,
				message.payload.capability ?? message.requestId,
			).then(
				(result) => sendResponse(rpcSuccess(result)),
				(error) => sendResponse(rpcFailure(
					'content_runtime_load_failed',
					error instanceof Error ? error.message : String(error),
					true,
				)),
			);
			return true;
		}

		if (message.type === PROTO_RUNTIME_RELEASE
			&& message.payload.tabId !== undefined
			&& message.payload.documentId !== undefined
			&& message.payload.reason !== undefined
			&& message.payload.capability !== undefined) {
			if (!canReleaseRuntimeConsumer(sender)) {
				sendResponse(rpcFailure('forbidden', 'A document cannot release another runtime consumer'));
				return false;
			}
			releaseContentRuntimeLease(
				message.payload.tabId,
				message.payload.documentId,
				message.payload.reason,
				message.payload.capability,
			);
			sendResponse(rpcSuccess({ accepted: true as const }));
			return false;
		}

		const identity = senderIdentity(sender);
		if (!identity) {
			sendResponse(rpcFailure('forbidden', 'Runtime lifecycle requires a document identity'));
			return false;
		}
		if (message.type === PROTO_RUNTIME_READY) {
			if (message.payload.runtimeRevision !== SPECTRA_CONTENT_RUNTIME_REVISION) {
				sendResponse(rpcFailure('runtime_revision_mismatch', 'Unexpected content runtime revision'));
				return false;
			}
			void currentTopDocumentId(identity.tabId).then(
				(currentDocumentId) => {
					if (currentDocumentId !== identity.documentId) {
						sendResponse(rpcFailure('stale_document', 'Runtime READY belongs to a stale document'));
						return;
					}
					commitReady(identity.tabId, identity.documentId, message.payload.runtimeRevision);
					sendResponse(rpcSuccess({ accepted: true as const }));
				},
				(error) => sendResponse(rpcFailure(
					'runtime_identity_unavailable',
					error instanceof Error ? error.message : String(error),
					true,
				)),
			);
			return true;
		}

		forgetDocument(identity.tabId, identity.documentId);
		sendResponse(rpcSuccess({ accepted: true as const }));
		return false;
	});

	chrome.tabs.onRemoved.addListener((tabId) => forgetDocument(tabId));
	chrome.webNavigation.onCommitted.addListener((details) => {
		if (details.frameId === 0) forgetDocument(details.tabId);
	});
	const reconcileSameDocument = (details: {
		frameId: number;
		tabId: number;
		documentId: string;
		url: string;
	}): void => {
		if (details.frameId !== 0) return;
		resumeDocumentInitialization(details.tabId, details.documentId, details.url);
		void Promise.allSettled([
			reconcileHotkeyRuntimeLease(details.tabId, details.documentId, details.url),
		]);
	};
	chrome.webNavigation.onHistoryStateUpdated.addListener(reconcileSameDocument);
	chrome.webNavigation.onReferenceFragmentUpdated.addListener(reconcileSameDocument);
	// Full navigations normally acquire their hotkey lease from the manifest
	// bootstrap HELLO. DOMContentLoaded is an independent retry boundary for the
	// cases where that document-start message races service-worker startup.
	chrome.webNavigation.onDOMContentLoaded.addListener(reconcileSameDocument);
}

// Test-only reset for module-scoped MV3 state. It is tree-shaken from the
// production entry because background imports only the initializer/ensure API.
export function resetContentRuntimeLoaderForTests(): void {
	for (const waiter of waiters.values()) {
		clearTimeout(waiter.timeoutId);
		waiter.reject(new Error('Content runtime loader test reset'));
	}
	readyDocuments.clear();
	loadingDocuments.clear();
	disposingDocuments.clear();
	waiters.clear();
	leases.clear();
	mediaObservationLoads.clear();
	loaderGeneration += 1;
	releasedMediaIntents.clear();
	retiredRuntimeKeys.clear();
	for (const timer of disposeTimers.values()) clearTimeout(timer);
	disposeTimers.clear();
	resetDocumentSiteHotkeysForTests();
	documentInitializations.clear();
	runtimeProbes = createSettlementPool(RUNTIME_PROBE_CONCURRENCY);
	restoreDocumentForInitialization = (...args) => restoreIfConfigured(...args);
	initialized = false;
}

function presetRestorePatch(config: AudioConfig): ControlSessionPatch {
	if (isDefaultAudioConfig(config)) return {};
	const volume = resolveAudioVolume(config);
	return {
		...(config.enabled ? {
			volumeBase: volume.volumeBase,
			mediaMuted: config.muted,
			speed: config.speed,
			preservePitch: config.preservePitch,
		} : {}),
		audioEnabled: config.enabled,
		boost: config.enabled ? volume.boost : 1,
		eqValues: config.enabled ? [...config.eqValues] : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
		bass: config.enabled && config.bass,
		compressor: config.enabled && config.compressor,
		mono: config.enabled && config.mono,
		pan: config.enabled ? config.pan : 0,
		delay: config.enabled ? config.delay : 0,
	};
}

function splitDocumentRestorePatch(patch: ControlSessionPatch): Array<{
	requestedCoverage: 'active-target' | 'full';
	patch: ControlPatch;
}> {
	const media: ControlPatch = {};
	const video: ControlPatch = {};
	const full: ControlPatch = {};
	for (const [rawField, value] of Object.entries(patch)) {
		const field = rawField as ControlField;
		const scope = selectControlCapabilityScope(field);
		const target = scope === 'active-video'
			? video
			: scope === 'document'
				|| controlCapabilityUsesStrategy(field, 'capture') && !controlCapabilityUsesStrategy(field, 'dom-native')
				? full
				: media;
		(target as Record<string, unknown>)[field] = structuredClone(value);
	}
	return [
		...(Object.keys(media).length > 0
			? [{ requestedCoverage: 'active-target' as const, patch: media }]
			: []),
		...(Object.keys(video).length > 0
			? [{ requestedCoverage: 'active-target' as const, patch: video }]
			: []),
		...(Object.keys(full).length > 0
			? [{ requestedCoverage: 'full' as const, patch: full }]
			: []),
	];
}

async function resolveDocumentRestorePlan(
	tabId: number,
	documentId: string,
	resourceUrl: string,
): Promise<{ patch: ControlSessionPatch; source: 'session' | 'preset' }> {
	const identity = storage.tabSession.identity(tabId, documentId, resourceUrl);
	const sessionPatch = await storage.tabSession.rebind(tabId, identity);
	if (sessionPatch) return { patch: sessionPatch, source: 'session' };
	const hostname = new URL(identity.resourceUrl).hostname;
	// A fresh tab on an origin where the user made origin-portable adjustments
	// in another tab inherits those adjustments as a same-origin baseline,
	// layered on top of the per-site/global preset (fields the user never
	// touched still fall back to the preset or default).
	let originPatch: ControlSessionPatch | null = null;
	try {
		originPatch = await storage.originSession.get(identity.origin);
	} catch {
		originPatch = null;
	}
	if (originPatch && Object.keys(originPatch).length > 0) {
		const preset = presetRestorePatch(await settingsRepository.resolveAudioConfig(hostname));
		return { patch: { ...preset, ...originPatch }, source: 'session' };
	}
	return {
		patch: presetRestorePatch(await settingsRepository.resolveAudioConfig(hostname)),
		source: 'preset',
	};
}

export const runtimeLoaderTestApi = {
	recoverFailedRestoreLease,
	setDocumentRestore(restore: DocumentRestore): void {
		restoreDocumentForInitialization = restore;
	},
	resolveDocumentRestorePlan,
	splitDocumentRestorePatch,
	isContentDocumentUrl,
};
