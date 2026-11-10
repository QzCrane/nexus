// goal: authoritative per-field intent ordering, actual ACK commit, and snapshot projection

import {
	audioSessionMatchesControlDocument,
	clampControlValue,
	compileEffectiveVolume,
	CONTROL_VALUE_LIMITS,
	createBoundedMap,
	createSpectraEvent,
	compareMediaObservations,
	isActiveCaptureLifecycle,
	isControlApplyAck,
	isControlObservationStrategy,
	isControlOperationAck,
	isControlSnapshot,
	normalizeHostname,
	resolveAcknowledgedAudioVolumeState,
	resolveAudioVolume,
	resolveControlAudioVolume,
	rpcFailure,
	rpcSuccess,
	SPECTRA_PROTOCOL_VERSION,
	splitEffectiveVolume,
	stepEffectiveVolume,
	type CaptureAdmission,
	type AudioSessionSnapshot,
	type ControlApplyAck,
	type ControlCapability,
	type ControlCoverage,
	type ControlDirectField,
	type ControlField,
	type ControlFieldStates,
	type ControlIntent,
	type ControlOperationAck,
	type ControlOperationIntent,
	type ControlOperationRequest,
	type ControlObservationStrategies,
	type ControlOperationResult,
	type ControlPatch,
	type ControlReadResult,
	type ControlSessionPatch,
	type ControlSnapshot,
	type ControlStrategy,
	type ControlSubmitRequest,
	type ControlValues,
	type MediaTarget,
	type MediaObservationStamp,
	type RpcError,
} from '@nexus/contracts';
import {
	AUDIO_PROJECTION_FIELDS,
	assertAppliedFields,
	assertAppliedPatch,
	assertReleasedPatch,
	assertUnambiguousTargetScope,
	controlSessionScopeForSource,
	createIntent,
	defaultControlValue,
	applyMutation,
	nativeObservationFields,
	neutralBoostObservation,
	PAGE_OBSERVABLE_FIELDS,
	ORDERED_MEDIA_FIELDS,
	projectControlSessionPatch,
	projectControlTarget,
	RESET_AUDIO_PROCESSOR_PATCH,
	RESET_AUDIO_TARGET_PATCH,
	RESET_VIDEO_PATCH,
	RESTORABLE_PROCESSOR_FIELDS,
	RESTORABLE_TARGET_FIELDS,
	sameMediaTarget,
	sameMediaObservationSelection,
	mergeMediaObservedFields,
	retireMediaActualFields,
	snapshotActualPatch,
	stageSnapshot,
	operationIntent,
	applyPageObservation,
	assignFieldState,
} from './control-coordinator-values';
import { controlApplyAckMatches, controlOperationAckMatches } from './control-coordinator-ack';
import {
	assertInvocationTargetCurrent,
	assertPopupRequestDocument,
	grantContentInvocation,
	popupInvocation,
	sameExtensionDocument,
	type ExtensionInvocationContext,
} from './extension-invocation';
import { createPopupVisualizerSource } from './popup-visualizer-source';
import { isActionPopupSender } from './popup-document-sender';
import { authorizeRuntimeControl } from './control-source-authorization';
import {
	mintCaptureAdmission,
	revokeCaptureAdmission,
	revokeCaptureAdmissionsForTab,
	forgetCaptureAdmissionsForTab,
} from './capture-admission';
import {
	createKeyedSerializedQueue,
	type TabControlSessionIdentity,
	type TabControlSessionScope,
} from '@nexus/kernel';
import { readSpectraTabPassively, sendSpectraTabRequest } from './spectra-tab-client';
import { settingsRepository } from './settings-repository';
import { storage } from './state';
import {
	invalidatePaintedBadge,
	isBadgeProjected,
	markBadgeUsedForTab,
	restoreBadgeUsageForTab,
	updateBadgeFromControlProjection,
} from './handlers/badge';
import { executeUserScriptInTab } from './handlers/user-scripts';
import { fenceAudioSession, getAudioSession } from './audio-session-store';
import {
	ensureContentRuntime,
	awaitDocumentInitialization,
	hasRuntimeLease,
	releaseContentRuntimeLease,
	releaseSourceRuntimeLease,
	retainSourceRuntimeLease,
	retainMediaIntentRuntimeLease,
	releaseMediaIntentRuntimeLease,
} from './runtime-loader';
import { swLog } from '../shared/logger';
import { isBackgroundRequestEnvelope, RPC_INVALID_REQUEST } from './background-rpc';
import type {
	PopupControlBatch,
	PopupControlBatchResult,
} from './popup-control-port';
const CONTROL_COVERAGE_TARGET = 'active-target' as const;
const CONTROL_STRATEGY_EXTENSION = 'extension-state' as const;
const CONTROL_STRATEGY_CHROME_NATIVE = 'chrome-native' as const;
const PROTO_ACTUAL_READ = 'spectra.control.actual.read' as const;
const PROTO_INTENT_SUBMIT = 'spectra.control.intent.submit' as const;
const PROTO_OPERATION_SUBMIT = 'spectra.control.operation.submit' as const;
const PROTO_SNAPSHOT_GET = 'spectra.control.snapshot.get' as const;
const PROTO_SOURCE_RELEASED = 'spectra.content.source.released' as const;
const PROTO_TARGET_CHANGED = 'spectra.content.target.changed' as const;


const STORAGE_PREFIX = 'spectra.control.tab.';
const GENERATION_PREFIX = 'spectra.control.generation.';
const snapshots = new Map<number, ControlSnapshot>();
const serialized = createKeyedSerializedQueue<number>();
// This lane contains snapshot admission/storage only, never a media writer or
// its stabilization wait. Physical playback samples can pass a slow speed ACK.
const snapshotPublications = createKeyedSerializedQueue<number>();
const retiredMediaSources = createBoundedMap<string, number>({ cap: 2_048, ttlMs: 300_000 });
// Deferred per-tab session projections. Each commit answers its requester
// before the projection runs; chaining per tab preserves commit order while
// keeping the projection off the serialized ACK path of later commits.
const sessionProjectionTails = createBoundedMap<number, Promise<unknown>>({
	cap: 256,
	// A projection tail is short-lived by construction; the ceiling and this age
	// limit are backstops for a tail whose owner never settles (INV-12).
	ttlMs: 60_000,
});

function scheduleSessionProjection(
	tabId: number,
	run: () => Promise<unknown>,
): void {
	const previous = sessionProjectionTails.get(tabId) ?? Promise.resolve();
	const tail = previous.catch(() => undefined).then(run);
	sessionProjectionTails.set(tabId, tail);
	void tail.then(
		() => releaseProjectionTail(tabId, tail),
		(error: unknown) => {
			releaseProjectionTail(tabId, tail);
			swLog.warn(`[Control] Session projection for tab ${tabId} failed: ${error instanceof Error ? error.message : String(error)}`);
		},
	);
}

// Only the newest tail is ever awaited, so a settled tail that nothing has
// chained onto is dead weight. Keeping it keyed by tabId forever was SP-50:
// every tab that ever committed a control transaction leaked one map entry.
function releaseProjectionTail(tabId: number, tail: Promise<unknown>): void {
	if (sessionProjectionTails.get(tabId) === tail) sessionProjectionTails.delete(tabId);
}

// Settles every scheduled per-tab session projection. Used by the test surface
// so assertions on the durable tab_session rows do not race the detached
// commit tail; production never waits on projections.
async function flushSessionProjections(): Promise<void> {
	await Promise.all([...sessionProjectionTails.values()]).catch(() => undefined);
	sessionProjectionTails.clear();
}

// One pending observation projection per tab. A page-native volume gesture emits a
// burst of observations and every one of them is an admitted fact, but only the
// newest can be the current projection: queueing one task per sample turned a
// single drag into a serialized train of storage reads and Action paints.
const pendingObservationSnapshots = createBoundedMap<number, {
	snapshot: ControlSnapshot;
	resourceFields: ControlFieldStates;
	epoch: number;
}>({
	cap: 256,
	ttlMs: 60_000,
});

function scheduleObservationProjection(snapshot: ControlSnapshot, resourceFields: ControlFieldStates, epoch: number): void {
	const previous = pendingObservationSnapshots.get(snapshot.tabId);
	const coalesced = previous !== undefined;
	pendingObservationSnapshots.set(snapshot.tabId, { snapshot, epoch,
		resourceFields: { ...(previous?.epoch === epoch && previous.snapshot.documentId === snapshot.documentId
			? previous.resourceFields : {}), ...resourceFields } });
	if (coalesced) return;
	scheduleSessionProjection(snapshot.tabId, async () => {
		const latest = pendingObservationSnapshots.get(snapshot.tabId);
		pendingObservationSnapshots.delete(snapshot.tabId);
		if (!latest) return;
		if (Object.keys(latest.resourceFields).length > 0) {
			// Page events retain exact-resource actual, never origin preferences.
			// Passive RPC reads only refresh presentation. Both use this bounded
			// tail so dragging does not enqueue a storage write for every sample.
			const changed: ControlFieldStates = {};
			for (const field of Object.keys(latest.resourceFields) as ControlField[]) {
				Object.assign(changed, { [field]: latest.snapshot.fields[field] });
			}
			await persistControlProjection(latest.snapshot, changed, {}, 'resource', latest.epoch);
		} else await projectBadgeFromSnapshot(latest.snapshot, undefined, { observationOnly: true });
	});
}
// Navigation is fenced synchronously before its durable transition enters the
// per-tab queue. A queued invalidation alone is insufficient: a control
// transaction may be awaiting Content/storage while Chrome has already moved
// the tab to another document. The epoch lets every in-flight transaction
// reject before it can publish its old generation.
interface NavigationFence {
	route?: { documentId: string; url: string };
	epoch: number;
	generationFloor: number;
	// A fence remains pending from the synchronous browser lifecycle callback
	// until its serialized durable transition completes. In-flight control work
	// must not synthesize/persist the next generation in that window.
	pending: boolean;
	beforeNavigate: boolean;
	settled: boolean;
	settlement?: Promise<void>;
}

const navigationFences = new Map<number, NavigationFence>();
const snapshotFenceEpochs = new WeakMap<ControlSnapshot, number>();
// A failed/stale storage write may be ambiguous even after the in-memory
// snapshot is rolled back. Until a later successful publish replaces it, do
// not use that durable value as the state to carry across navigation.
const stalePersistedSnapshots = new Set<number>();
let initialized = false;

type RoutedControlSubmitRequest = Omit<ControlSubmitRequest, 'tabId'> & {
	releaseDocumentOutput?: true;
	tabId: number;
	captureAdmission?: CaptureAdmission;
	observationDocumentId?: string;
};
type ResolvedControlSubmitRequest = Omit<RoutedControlSubmitRequest, 'patch' | 'mutations'> & {
	patch: ControlPatch;
};
type RoutedControlOperationRequest = ControlOperationRequest & {
	tabId: number;
	captureAdmission?: CaptureAdmission;
};

// Shared with worker-restart startup recovery: a persisted processor-required
// session must retain the content runtime with this exact owned-control lease so
// a later commit flips (and releases) it through the existing ownership logic.
export const RUNTIME_OWNER_CAPABILITY = 'owned-control-state';
const RUNTIME_RESIDENT_NATIVE_FIELDS = new Set<ControlField>([
	'volumeBase',
	'mediaMuted',
	'speed',
	'preservePitch',
	'loop',
]);

function hasRuntimeOwnedState(snapshot: ControlSnapshot): boolean {
	return Object.entries(snapshot.fields).some(([rawField, state]) => {
		if (!state?.controlled || (state.phase !== 'applied' && state.phase !== 'error')) return false;
		const field = rawField as ControlField;
		if (field === 'audioEnabled') return false;
		if (state.strategy === CONTROL_STRATEGY_CHROME_NATIVE
			|| state.strategy === 'observe' || state.strategy === 'unsupported') return false;
		if (state.strategy === 'dom-native') return RUNTIME_RESIDENT_NATIVE_FIELDS.has(field);
		return true;
	});
}

async function reconcileRuntimeOwnership(snapshot: ControlSnapshot): Promise<void> {
	if (hasRuntimeOwnedState(snapshot)) {
		// The owned-state lease is acquired by the first commit that made the
		// state owned and released only by this function when ownership flips.
		// Every later crossing on the same document re-verifies the top document
		// (one getFrame IPC) for no state change; commitControlFields already
		// fenced this transaction against navigation, so a held lease proves the
		// runtime stays alive until ownership actually changes.
		if (hasRuntimeLease(
			snapshot.tabId,
			snapshot.documentId,
			'control',
			RUNTIME_OWNER_CAPABILITY,
		)) {
			return;
		}
		await ensureContentRuntime(
			snapshot.tabId,
			snapshot.documentId,
			'control',
			RUNTIME_OWNER_CAPABILITY,
		);
		return;
	}
	releaseContentRuntimeLease(
		snapshot.tabId,
		snapshot.documentId,
		'control',
		RUNTIME_OWNER_CAPABILITY,
	);
}

function storageKey(tabId: number): string {
	return `${STORAGE_PREFIX}${tabId}`;
}

function generationKey(tabId: number): string {
	return `${GENERATION_PREFIX}${tabId}`;
}

async function currentIdentity(tabId: number): Promise<TabControlSessionIdentity> {
	const epoch = navigationEpoch(tabId);
	const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
	if (!frame?.documentId) throw new Error('The tab has no current document');
	const fence = navigationFences.get(tabId);
	// Seed a restarted worker once. A late frame read must never overwrite a
	// newer route already observed by a synchronous Chrome navigation callback.
	if (navigationEpoch(tabId) === epoch && !fence?.route && !fence?.beforeNavigate) {
		const route = { documentId: frame.documentId, url: frame.url };
		if (fence) fence.route = route;
		else navigationFences.set(tabId, { epoch: 0, generationFloor: 0, pending: false, beforeNavigate: false, settled: true, route });
	}
	return storage.tabSession.identity(tabId, frame.documentId, frame.url);
}

async function readPersistedSnapshot(tabId: number): Promise<ControlSnapshot | null> {
	const key = storageKey(tabId);
	const stored = await chrome.storage.local.get(key)
		.catch(() => ({})) as Record<string, unknown>;
	const value = stored[key];
	return isControlSnapshot(value) ? value : null;
}

/**
 * The persisted generation is the only ordering authority that survives a
 * service-worker restart. A read failure is not the same fact as "nothing was
 * ever stored": answering 0 would hand the next transaction a lower generation
 * than a content runtime may still be holding, which silently revives exactly
 * the requests that generation existed to reject (SP-71). Fail closed instead —
 * an unavailable authority must not be replaced by a guess.
 *
 * A missing key is a legitimate 0: no transaction has ever run for this tab.
 */
async function readPersistedGeneration(tabId: number): Promise<number> {
	const key = generationKey(tabId);
	const stored = await chrome.storage.local.get(key) as Record<string, unknown>;
	const value = stored[key];
	if (value === undefined) return 0;
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new Error(`Persisted control generation for tab ${tabId} is not a counter`);
	}
	return Number(value);
}

async function persistGeneration(tabId: number, generation: number): Promise<void> {
	await chrome.storage.local.set({ [generationKey(tabId)]: generation })
		.catch((error) => swLog.warn('persistGeneration failed', error));
}

function navigationEpoch(tabId: number): number {
	return navigationFences.get(tabId)?.epoch ?? 0;
}

function rememberSnapshot(snapshot: ControlSnapshot): ControlSnapshot {
	snapshotFenceEpochs.set(snapshot, navigationEpoch(snapshot.tabId));
	return snapshot;
}

function assertNavigationFence(
	tabId: number,
	expectedEpoch: number,
	snapshot?: Pick<ControlSnapshot, 'generation'>,
): void {
	const fence = navigationFences.get(tabId);
	if (expectedEpoch !== navigationEpoch(tabId)
		|| fence && snapshot && snapshot.generation < fence.generationFloor) {
		throw new Error('Control transaction was invalidated by navigation');
	}
}

/**
 * Advance the in-memory lifecycle fence before any asynchronous navigation
 * work is queued. This function intentionally performs no persistence or
 * publication; those effects remain serialized with control mutations.
 */
function fenceNavigation(
	tabId: number,
	preserveDocumentState = false,
	beforeNavigate = false,
): number {
	// Revoke before any asynchronous navigation work. A grant issued for the old
	// document must not survive long enough to reach the physical Capture owner.
	revokeCaptureAdmissionsForTab(tabId);
	fenceAudioSession(tabId, preserveDocumentState);
	const previous = navigationFences.get(tabId);
	const knownGeneration = snapshots.get(tabId)?.generation ?? 0;
	const fence: NavigationFence = {
		...(preserveDocumentState && previous?.route ? { route: previous.route } : {}),
		epoch: (previous?.epoch ?? 0) + 1,
		generationFloor: Math.max(previous?.generationFloor ?? 0, knownGeneration + 1),
		pending: true,
		beforeNavigate,
		settled: false,
	};
	navigationFences.set(tabId, fence);
	return fence.epoch;
}

function assertPassiveReadFence(
	tabId: number,
	expectedEpoch: number,
	generation?: number,
): void {
	assertNavigationFence(
		tabId,
		expectedEpoch,
		generation === undefined ? undefined : { generation },
	);
	if (navigationFences.get(tabId)?.pending || navigationFences.get(tabId)?.beforeNavigate) {
		throw new Error('Control view read was invalidated by navigation');
	}
}

async function getSnapshot(tabId: number): Promise<ControlSnapshot | null> {
	const known = snapshots.get(tabId)
		?? (stalePersistedSnapshots.has(tabId) ? null : await readPersistedSnapshot(tabId));
	if (!known) return null;
	const fence = navigationFences.get(tabId);
	if (fence?.pending || fence?.beforeNavigate || fence && known.generation < fence.generationFloor) return null;
	const identity = await currentIdentity(tabId).catch(() => null);
	if (!identity
		|| known.documentId !== identity.documentId
		|| known.origin !== identity.origin) return null;
	const currentFence = navigationFences.get(tabId);
	if (currentFence?.pending || currentFence?.beforeNavigate
		|| currentFence && known.generation < currentFence.generationFloor) return null;
	const latest = snapshots.get(tabId);
	if (latest && latest.documentId === identity.documentId && latest.origin === identity.origin) return rememberSnapshot(latest);
	snapshots.set(tabId, known);
	return rememberSnapshot(known);
}

// post: the control state a card may paint, read one-way. This is a view, not a
// handshake: it asks the document's own lean bootstrap what it can observe and
// never acquires the Content runtime, so rendering a card for a tab the user is
// not looking at cannot wake that tab. A document that cannot answer passively
// leaves the fields it cannot prove unknown rather than being loaded to find out.
export async function getControlViewSnapshot(tabId: number): Promise<ControlSnapshot | null> {
	const expectedEpoch = navigationEpoch(tabId);
	const existing = await getSnapshot(tabId);
	assertPassiveReadFence(tabId, expectedEpoch, existing?.generation);
	const identity = await currentIdentity(tabId).catch(() => null);
	if (!identity) return existing;
	assertPassiveReadFence(tabId, expectedEpoch, existing?.generation);
	const generation = existing?.generation ?? await readPersistedGeneration(tabId);
	assertPassiveReadFence(tabId, expectedEpoch, generation);
	const videoFields = ['pip', 'fullscreen'] as const satisfies readonly ControlDirectField[];
	const mediaFields = [...PAGE_OBSERVABLE_FIELDS]
		.filter((field): field is ControlDirectField => !videoFields.includes(field as typeof videoFields[number]));
	const read = (fields: readonly ControlDirectField[]) => readSpectraTabPassively(
		tabId,
		PROTO_ACTUAL_READ,
		{ fields, target: null },
		{ documentId: identity.documentId, generation },
	).catch(() => null);
	const [mediaResponse, videoResponse] = await Promise.all([
		read(mediaFields),
		read(videoFields),
	]);
	assertPassiveReadFence(tabId, expectedEpoch, generation);
	const postReadIdentity = await currentIdentity(tabId).catch(() => null);
	if (!postReadIdentity
		|| postReadIdentity.documentId !== identity.documentId
		|| postReadIdentity.origin !== identity.origin) {
		throw new Error('Control view read completed for a stale document');
	}
	assertPassiveReadFence(tabId, expectedEpoch, generation);
	if (!mediaResponse?.ok && !videoResponse?.ok && !existing) return null;
	const latest = snapshots.get(tabId);
	const base: ControlSnapshot = latest?.documentId === identity.documentId ? latest : existing ?? {
		tabId,
		documentId: identity.documentId,
		origin: identity.origin,
		generation,
		revision: 0,
		activeMedia: null,
		activeVideo: null,
		fields: {},
	};
	if (mediaResponse?.ok && mediaResponse.data.mediaObservation || videoResponse?.ok && videoResponse.data.mediaObservation) {
		let admitted = base;
		if (mediaResponse?.ok) admitted = await admitPhysicalObservation(admitted, mediaResponse.data, 'media', expectedEpoch);
		if (videoResponse?.ok) admitted = await admitPhysicalObservation(admitted, videoResponse.data, 'video', expectedEpoch);
		return admitted;
	}
	// A view read reports what the page currently shows, and it may not erase an
	// applied extension-owned ACK. For a field the extension is controlling right
	// now, the DOM value is the input the processor reads - not the effective
	// output the card must show - so replacing that ACK with a raw observation
	// would repaint a routed tab as untouched. Fields the extension does not own
	// are exactly the ones a passive read is allowed to refresh.
	const observedViewFields = (
		response: Awaited<ReturnType<typeof read>>,
	): ControlFieldStates => {
		if (!response?.ok) return {};
		const observed = nativeObservationFields(response.data, base.revision);
		for (const field of Object.keys(observed) as ControlField[]) {
			const owned = base.fields[field];
			if (field !== 'playing' && owned?.controlled === true && owned.phase === 'applied') delete observed[field];
		}
		return observed;
	};
	const fields: ControlFieldStates = {
		...base.fields,
		...observedViewFields(mediaResponse),
		...observedViewFields(videoResponse),
	};
	// A historical play ACK does not prove current playback after a passive
	// read failed. Preserve other owned fields while exposing playback unknown.
	if (!mediaResponse?.ok || typeof mediaResponse.data.patch.playing !== 'boolean') delete fields.playing;
	const activeMedia = mediaResponse?.ok
		? mediaResponse.data.target
		: mediaResponse?.error.code === 'capability-unavailable'
			? null
			: base.activeMedia;
	const observedVideo = videoResponse?.ok
		? videoResponse.data.target
		: videoResponse?.error.code === 'capability-unavailable'
			? null
			: base.activeVideo;
	return {
		...base,
		activeMedia,
		activeVideo: observedVideo?.kind === 'video' ? observedVideo : null,
		fields,
	};
}

async function getOrCreateSnapshot(tabId: number): Promise<ControlSnapshot> {
	if (navigationFences.get(tabId)?.pending || navigationFences.get(tabId)?.beforeNavigate) {
		throw new Error('Control transaction was invalidated by navigation');
	}
	const existing = await getSnapshot(tabId);
	if (existing) return existing;
	const [identity, persisted, storedGeneration] = await Promise.all([
		currentIdentity(tabId),
		stalePersistedSnapshots.has(tabId)
			? Promise.resolve(null)
			: readPersistedSnapshot(tabId),
		readPersistedGeneration(tabId),
	]);
	if (navigationFences.get(tabId)?.pending || navigationFences.get(tabId)?.beforeNavigate) {
		throw new Error('Control transaction was invalidated by navigation');
	}
	const generation = persisted
		&& (persisted.documentId !== identity.documentId || persisted.origin !== identity.origin)
		? Math.max(storedGeneration, persisted.generation + 1)
		: storedGeneration;
	const fencedGeneration = Math.max(
		generation,
		navigationFences.get(tabId)?.generationFloor ?? 0,
	);
	if (fencedGeneration !== storedGeneration) await persistGeneration(tabId, fencedGeneration);
	if (navigationFences.get(tabId)?.pending || navigationFences.get(tabId)?.beforeNavigate) {
		throw new Error('Control transaction was invalidated by navigation');
	}
	return rememberSnapshot({
		tabId,
		documentId: identity.documentId,
		origin: identity.origin,
		generation: fencedGeneration,
		revision: 0,
		activeMedia: null,
		activeVideo: null,
		fields: {},
	});
}

async function resolveSubmitRequest(
	snapshot: ControlSnapshot,
	request: RoutedControlSubmitRequest,
): Promise<ResolvedControlSubmitRequest> {
	assertUnambiguousTargetScope(request);
	const patch: ControlPatch = { ...(request.patch ?? {}) };
	const baselines: ControlPatch = {};
	let resolvedTarget = request.target;
	let requestedCoverage = request.requestedCoverage;
	const missingFields = [...new Set((request.mutations ?? [])
		.map((mutation) => mutation.field)
		.filter((field) => patch[field] === undefined
			&& (field === 'playing' || snapshot.fields[field]?.actual === undefined
				|| request.target === null && field !== 'tabMuted' && field !== 'tabPinned'
					&& (PAGE_OBSERVABLE_FIELDS.has(field) || !AUDIO_PROJECTION_FIELDS.has(field)))))];
	const tabFields = missingFields.filter((field) => field === 'tabMuted' || field === 'tabPinned');
	if (tabFields.length > 0) {
		const tab = await chrome.tabs.get(request.tabId);
		for (const field of tabFields) {
			(baselines as Record<string, unknown>)[field] = field === 'tabMuted'
				? tab.mutedInfo?.muted === true
				: tab.pinned === true;
		}
	}
	const contentFields = missingFields.filter((field) => field !== 'tabMuted' && field !== 'tabPinned');
	const implicitOutputControl = request.target === null && request.source !== 'page'
		&& Object.keys(patch).every(field => field === 'volumeBase' || field === 'mediaMuted')
		&& (patch.volumeBase !== undefined || patch.mediaMuted !== undefined
			|| (request.mutations ?? []).some(({ field }) => field === 'volumeBase' || field === 'mediaMuted'));
	if (implicitOutputControl && !contentFields.includes('volumeBase')) contentFields.push('volumeBase');
	if (contentFields.length > 0) {
		const response = await sendSpectraTabRequest(
			request.tabId,
			PROTO_ACTUAL_READ,
			{ fields: contentFields, target: resolvedTarget },
			{ documentId: snapshot.documentId, generation: snapshot.generation },
		);
		if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
		Object.assign(baselines, response.data.patch);
		resolvedTarget = response.data.target ?? resolvedTarget;
		if (implicitOutputControl && (request.source !== 'restore' && response.data.nativeAudioAbsent && response.data.observedStrategies.volumeBase !== 'page-native'
			|| response.data.observedStrategies.volumeBase === 'capture')) {
			requestedCoverage = 'full';
			if (response.data.observedStrategies.volumeBase !== 'capture') {
				// The video has no audio track. Its mute/volume are not the current
				// document output; before ownership the output attenuation is unity.
				baselines.volumeBase = 100;
				baselines.mediaMuted = false;
				patch.volumeBase ??= 100;
				patch.boost ??= typeof snapshot.fields.boost?.actual === 'number' ? snapshot.fields.boost.actual : 1;
			}
		}
	}
	for (const mutation of request.mutations ?? []) {
		const pending = patch[mutation.field] as ControlValues[ControlField] | undefined;
		const existing = baselines[mutation.field]
			?? snapshot.fields[mutation.field]?.actual
			?? snapshot.fields[mutation.field]?.desired
			?? defaultControlValue(mutation.field);
		(patch as Record<string, unknown>)[mutation.field] = applyMutation(
			pending ?? existing as ControlValues[ControlField],
			mutation,
		);
	}
	if (Object.keys(patch).length === 0) throw new Error('Control request has no effective mutation');
	return {
		tabId: request.tabId,
		source: request.source,
		requestedCoverage,
		...(request.releaseDocumentOutput ? { releaseDocumentOutput: true as const } : {}),
		...(request.mediaRestore ? { mediaRestore: request.mediaRestore } : {}),
		target: resolvedTarget,
		...(request.baseRevision === undefined ? {} : { baseRevision: request.baseRevision }),
		patch,
		...(request.captureAdmission
			? { captureAdmission: request.captureAdmission }
			: {}),
		...(request.observedStrategies === undefined
			? {}
			: { observedStrategies: request.observedStrategies }),
	};
}

async function applyChromeFields(intent: ControlIntent): Promise<{
	remaining: ControlPatch;
	fields: ControlFieldStates;
}> {
	const remaining = { ...intent.patch };
	const fields: ControlFieldStates = {};
	const revision = intent.baseRevision + 1;

	if (remaining.tabMuted !== undefined) {
		const desired = remaining.tabMuted;
		delete remaining.tabMuted;
		await chrome.tabs.update(intent.tabId, { muted: desired });
		const actual = (await chrome.tabs.get(intent.tabId)).mutedInfo?.muted === true;
		assignFieldState(fields, 'tabMuted', desired, actual, revision, intent.intentId);
	}
	if (remaining.tabPinned !== undefined) {
		const desired = remaining.tabPinned;
		delete remaining.tabPinned;
		await chrome.tabs.update(intent.tabId, { pinned: desired });
		const actual = (await chrome.tabs.get(intent.tabId)).pinned === true;
		assignFieldState(fields, 'tabPinned', desired, actual, revision, intent.intentId);
	}
	return { remaining, fields };
}

async function rollbackSnapshotPersistence(
	tabId: number,
	previous: ControlSnapshot | undefined,
	message: string,
): Promise<void> {
	try {
		if (previous) {
			await chrome.storage.local.set({ [storageKey(tabId)]: previous });
		} else {
			stalePersistedSnapshots.add(tabId);
			await chrome.storage.local.remove([storageKey(tabId)]);
		}
	} catch (rollbackError) {
		stalePersistedSnapshots.add(tabId);
		swLog.warn(message, rollbackError);
	}
}

interface PhysicalPublication {
	fields: ControlFieldStates;
	mediaObservation?: MediaObservationStamp;
	observation?: boolean;
	acknowledgementTarget?: MediaTarget | null;
	/** Present only when the sample actually proved the presentation's kind. */
	live?: boolean;
	/**
	 * The element that proof describes. A read can choose an element of its own
	 * (a targetless bootstrap read does), and a video-scoped read names the video
	 * while the snapshot's `live` describes the media target. Without this the
	 * fact was attributed to whatever happened to be active.
	 */
	liveTarget?: MediaTarget | null;
	prospectiveBoostRoute?: ControlSnapshot['prospectiveBoostRoute'];
	volumeBoostTarget?: MediaTarget;
}

function mediaSourceKey(tabId: number, target: MediaTarget): string {
	return `${tabId}:${target.documentId}:${target.frameId}:${target.mediaId}:${target.sourceRevision}`;
}

function isRetiredMediaSample(tabId: number, target: MediaTarget | null, stamp?: MediaObservationStamp): boolean {
	if (!target) return false;
	const epoch = retiredMediaSources.get(mediaSourceKey(tabId, target));
	return epoch !== undefined && (!stamp || stamp.epoch <= epoch);
}

function mediaSampleCanReplace(current: ControlSnapshot, stamp?: MediaObservationStamp): boolean {
	if (!current.mediaObservation) return true;
	if (!stamp) return false;
	const order = compareMediaObservations(stamp, current.mediaObservation);
	return order !== null && order >= 0;
}

function volumeObservationCanNormalize(current: ControlSnapshot, stamp?: MediaObservationStamp): boolean {
	const previous = current.fields.volumeBase?.mediaObservation;
	// Replayed/older evidence of the volume field is not another page gesture.
	// A newer playing sample alone does not make the volume evidence obsolete.
	return !previous || !!stamp && compareMediaObservations(stamp, previous) === 1;
}

function assertMediaAcknowledgementCurrent(
	current: ControlSnapshot,
	target: MediaTarget | null,
	stamp: MediaObservationStamp | undefined,
	fields: ControlFieldStates,
): void {
	if (isRetiredMediaSample(current.tabId, target, stamp)) throw new Error('Control ACK belongs to a retired media source');
	if (!current.mediaObservation) return;
	if (!stamp) {
		if (Object.entries(fields).some(([field, state]) => ORDERED_MEDIA_FIELDS.has(field as ControlField)
			&& state && !(state.desired === null && !state.controlled && state.lastError === null))) {
			throw new Error('An unstamped ACK cannot replace ordered media facts');
		}
		return;
	}
	const order = compareMediaObservations(stamp, current.mediaObservation);
	if (order === null || order < 0 && (!sameMediaObservationSelection(stamp, current.mediaObservation)
		|| !sameMediaTarget(target, current.activeMedia) && !sameMediaTarget(target, current.activeVideo))) {
		throw new Error('Control ACK belongs to an older media selection');
	}
}

async function admitPhysicalObservation(
	base: ControlSnapshot,
	result: ControlReadResult,
	scope: 'media' | 'video' = 'media',
	expectedEpoch = navigationEpoch(base.tabId),
	resourceObservation = false,
): Promise<ControlSnapshot> {
	if (result.target && result.target.documentId !== base.documentId) throw new Error('Physical sample belongs to a stale document');
	if (base.mediaObservation && !result.mediaObservation) return snapshots.get(base.tabId) ?? base;
	if (isRetiredMediaSample(base.tabId, result.target, result.mediaObservation)) return snapshots.get(base.tabId) ?? base;
	const fields = nativeObservationFields(result, base.revision);
	const proposed: ControlSnapshot = {
		...base,
		activeMedia: scope === 'media' ? result.target : base.activeMedia,
		activeVideo: scope === 'video' ? result.target?.kind === 'video' ? result.target : null
			: result.target?.kind === 'video' ? result.target
				: result.target === null && result.mediaObservation ? null : base.activeVideo,
		fields: { ...base.fields, ...fields },
		...(result.mediaObservation ? { mediaObservation: result.mediaObservation } : {}),
	};
	const published = await publishSnapshot(proposed, expectedEpoch, {
		fields,
		mediaObservation: result.mediaObservation,
		observation: true,
		// `live` is a fact about one element. A video-scoped read proves the video,
		// not the media target, and a targetless bootstrap read names no element at
		// all; both keep their proof but must not be written onto `activeMedia`.
		...(scope === 'media' && typeof result.live === 'boolean' && result.target
			? { live: result.live, liveTarget: result.target } : {}),
		...(scope === 'media' && result.target && Object.hasOwn(result, 'prospectiveBoostRoute')
			? { prospectiveBoostRoute: result.prospectiveBoostRoute, volumeBoostTarget: result.target } : {}),
	});
	// A native volume change is an admitted fact about this tab, so the badge —
	// which is nothing but a projection of admitted facts — has to follow it.
	// Passive reads write no session state. Page events also retain their
	// exact-resource state through the existing projection owner (SCTRL-055),
	// never origin preferences. Projection is off the fast path because a
	// gesture produces many samples and the Action API is not on our critical
	// path.
	const changedResourceFields: ControlFieldStates = {};
	if (resourceObservation) {
		for (const field of Object.keys(fields) as ControlField[]) {
			const accepted = published.fields[field];
			if (!accepted || accepted.actual !== fields[field]?.actual || accepted.actual === base.fields[field]?.actual) continue;
			if (ORDERED_MEDIA_FIELDS.has(field) && (!accepted.mediaObservation || !result.mediaObservation
				|| compareMediaObservations(accepted.mediaObservation, result.mediaObservation) !== 0)) continue;
			Object.assign(changedResourceFields, { [field]: accepted });
		}
	}
	if (Object.keys(changedResourceFields).length > 0 || Object.keys(fields).some((field) => AUDIO_PROJECTION_FIELDS.has(field as ControlField))) {
		scheduleObservationProjection(published, changedResourceFields, expectedEpoch);
	}
	return published;
}

/**
 * The presentation kind a publication is allowed to carry.
 *
 * `live` is a fact about one element, so it may only be published for the media
 * target the proof actually described. A proof about another element is not
 * weaker evidence — it is evidence about something else; inheriting the old
 * value across a target change made a finite advertisement report `live: true`
 * after the viewer left a broadcast, which disabled speed on an ordinary video.
 */
function publishedLive(
	current: ControlSnapshot | undefined,
	physical: PhysicalPublication | undefined,
	activeMedia: MediaTarget | null,
): boolean | undefined {
	if (typeof physical?.live === 'boolean' && physical.liveTarget) {
		return sameMediaTarget(physical.liveTarget, activeMedia) ? physical.live : undefined;
	}
	if (!current || !sameMediaTarget(current.activeMedia, activeMedia)) return undefined;
	return current.live;
}

function applyPublishedLive(snapshot: ControlSnapshot, live: boolean | undefined): ControlSnapshot {
	if (live === undefined) delete snapshot.live;
	else snapshot.live = live;
	return snapshot;
}

function applyPublishedProspectiveBoostRoute(
	current: ControlSnapshot | undefined, physical: PhysicalPublication | undefined, snapshot: ControlSnapshot,
): ControlSnapshot {
	let route: ControlSnapshot['prospectiveBoostRoute'];
	if (current && sameMediaTarget(current.activeMedia, snapshot.activeMedia)
		&& (!current.mediaObservation || !snapshot.mediaObservation
			|| sameMediaObservationSelection(current.mediaObservation, snapshot.mediaObservation))) {
		route = current.prospectiveBoostRoute;
	}
	if (physical && Object.hasOwn(physical, 'prospectiveBoostRoute') && physical.volumeBoostTarget
		&& sameMediaTarget(physical.volumeBoostTarget, snapshot.activeMedia)
		&& !isRetiredMediaSample(snapshot.tabId, physical.volumeBoostTarget, physical.mediaObservation)
		&& (!current || mediaSampleCanReplace(current, physical.mediaObservation))) {
		route = physical.prospectiveBoostRoute;
	}
	if (route === undefined) delete snapshot.prospectiveBoostRoute;
	else snapshot.prospectiveBoostRoute = route;
	return snapshot;
}

function mergeSnapshotPublication(
	current: ControlSnapshot | undefined,
	proposed: ControlSnapshot,
	physical?: PhysicalPublication,
): ControlSnapshot {
	if (!current || current.documentId !== proposed.documentId || current.generation !== proposed.generation) {
		return applyPublishedProspectiveBoostRoute(undefined, physical, applyPublishedLive({
			...proposed,
			fields: mergeMediaObservedFields({}, proposed.fields,
				physical?.mediaObservation ?? proposed.mediaObservation, physical?.observation === true),
		}, publishedLive(undefined, physical, proposed.activeMedia)));
	}
	const stamp = physical ? physical.mediaObservation : proposed.mediaObservation;
	const retiredSample = isRetiredMediaSample(proposed.tabId, proposed.activeMedia, stamp);
	const replacesSelection = mediaSampleCanReplace(current, stamp)
		&& !retiredSample;
	const sameSelection = !retiredSample && stamp && current.mediaObservation
		&& sameMediaTarget(proposed.activeMedia, current.activeMedia) && sameMediaObservationSelection(stamp, current.mediaObservation);
	let delta = physical?.fields ?? proposed.fields;
	const sameUnstampedTarget = !stamp && sameMediaTarget(proposed.activeMedia, current.activeMedia)
		&& (!physical || !Object.hasOwn(physical, 'acknowledgementTarget')
			|| sameMediaTarget(physical.acknowledgementTarget ?? null, current.activeMedia)
			|| sameMediaTarget(physical.acknowledgementTarget ?? null, current.activeVideo));
	if (!replacesSelection && !sameSelection && !sameUnstampedTarget) {
		const scoped = retireMediaActualFields(delta, true, true, proposed.revision);
		delta = Object.fromEntries(Object.entries(delta).filter(([field]) => !Object.hasOwn(scoped, field))) as ControlFieldStates;
	}
	const activeMedia = replacesSelection ? proposed.activeMedia : current.activeMedia;
	const activeVideo = replacesSelection ? proposed.activeVideo : current.activeVideo;
	const ownerChanged = !!stamp && !!current.mediaObservation && stamp.epoch !== current.mediaObservation.epoch;
	const retired = replacesSelection ? retireMediaActualFields(current.fields,
		ownerChanged || !sameMediaTarget(current.activeMedia, activeMedia),
		ownerChanged || !sameMediaTarget(current.activeVideo, activeVideo), proposed.revision) : {};
	return applyPublishedProspectiveBoostRoute(current, physical, applyPublishedLive({
		...proposed,
		activeMedia,
		activeVideo,
		fields: mergeMediaObservedFields({ ...current.fields, ...retired }, delta, stamp, physical?.observation === true),
		...(replacesSelection && stamp ? { mediaObservation: stamp }
			: current.mediaObservation ? { mediaObservation: current.mediaObservation } : {}),
	}, publishedLive(current, physical, activeMedia)));
}

async function publishSnapshot(
	proposed: ControlSnapshot,
	expectedEpoch = navigationEpoch(proposed.tabId),
	physical?: PhysicalPublication,
): Promise<ControlSnapshot> {
	return snapshotPublications(proposed.tabId, async () => {
		assertNavigationFence(proposed.tabId, expectedEpoch, proposed);
		const current = snapshots.get(proposed.tabId);
		if (current && physical && Object.hasOwn(physical, 'acknowledgementTarget')) {
			assertMediaAcknowledgementCurrent(current, physical.acknowledgementTarget ?? null, physical.mediaObservation, physical.fields);
		}
		const aligned = physical?.observation && current && current.documentId === proposed.documentId
			&& current.generation === proposed.generation && current.revision > proposed.revision
			? { ...proposed, revision: current.revision } : proposed;
		if (current && current.documentId === proposed.documentId && current.generation === proposed.generation
			&& current.revision > aligned.revision) throw new Error('Snapshot publication lost its control revision');
		const snapshot = mergeSnapshotPublication(current, aligned, physical);
		const unchanged = current && current.documentId === snapshot.documentId && current.origin === snapshot.origin
			&& current.generation === snapshot.generation && current.revision === snapshot.revision
			&& sameMediaTarget(current.activeMedia, snapshot.activeMedia) && sameMediaTarget(current.activeVideo, snapshot.activeVideo)
			&& (current.live ?? null) === (snapshot.live ?? null)
			&& current.prospectiveBoostRoute === snapshot.prospectiveBoostRoute
			&& Object.keys(snapshot.fields).every((key) => {
				const field = key as ControlField;
				const before = current.fields[field];
				const after = snapshot.fields[field];
				return before?.actual === after?.actual && before?.controlled === after?.controlled
					&& before?.phase === after?.phase && before?.strategy === after?.strategy
					&& before?.lastError === after?.lastError;
			});
		if (unchanged) {
			snapshots.set(snapshot.tabId, rememberSnapshot(snapshot));
			return snapshot;
		}
		await persistPublishedSnapshot(snapshot, expectedEpoch);
		return snapshot;
	});
}

async function persistPublishedSnapshot(
	snapshot: ControlSnapshot,
	expectedEpoch = navigationEpoch(snapshot.tabId),
): Promise<void> {
	assertNavigationFence(snapshot.tabId, expectedEpoch, snapshot);
	const previous = snapshots.get(snapshot.tabId);
	snapshots.set(snapshot.tabId, snapshot);
	try {
		await chrome.storage.local.set({ [storageKey(snapshot.tabId)]: snapshot });
	} catch (error) {
		if (previous) snapshots.set(snapshot.tabId, previous);
		else snapshots.delete(snapshot.tabId);
		await rollbackSnapshotPersistence(
			snapshot.tabId,
			previous,
			'Unable to roll back a failed control snapshot write',
		);
		throw error;
	}
	// A browser lifecycle event can arrive while storage.set is in flight. Do
	// not broadcast or leave the new in-memory value visible after that fence.
	try {
		assertNavigationFence(snapshot.tabId, expectedEpoch, snapshot);
	} catch (error) {
		if (previous) snapshots.set(snapshot.tabId, previous);
		else snapshots.delete(snapshot.tabId);
		await rollbackSnapshotPersistence(
			snapshot.tabId,
			previous,
			'Unable to roll back a fenced control snapshot write',
		);
		throw error;
	}
	stalePersistedSnapshots.delete(snapshot.tabId);
	rememberSnapshot(snapshot);
	const event = createSpectraEvent('spectra.control.snapshot.changed', snapshot, {
		tabId: snapshot.tabId,
		documentId: snapshot.documentId,
		generation: snapshot.generation,
	});
	// Notify extension pages without blocking the requester. Receivers (Popup
	// card, SidePanel, Remote) classify snapshots by document/generation and are
	// idempotent, so delivery order relative to the submit ACK is irrelevant and
	// waiting for every listener would only widen the post-commit fence window.
	void chrome.runtime.sendMessage(event).catch(() => undefined);
	// Keep the in-memory and durable owners aligned even if the lifecycle
	// callback fires right after the notification is dispatched.
	try {
		assertNavigationFence(snapshot.tabId, expectedEpoch, snapshot);
	} catch (error) {
		if (previous) snapshots.set(snapshot.tabId, previous);
		else snapshots.delete(snapshot.tabId);
		await rollbackSnapshotPersistence(
			snapshot.tabId,
			previous,
			'Unable to roll back a control snapshot after notification fencing',
		);
		throw error;
	}
}

/**
 * The only composer that turns admitted control facts into an Action badge.
 *
 * Two very different routes reach the badge — an extension ACK that also writes
 * the durable per-origin session, and a page-native observation that must never
 * write it (SCTRL-017) — and both must paint from the same rules. Keeping the
 * composition here is what stops the second route from being forgotten: it was,
 * and every native volume change left the badge on the last extension intent.
 */
async function projectBadgeFromSnapshot(
	snapshot: ControlSnapshot,
	projection?: ControlSessionPatch,
	options: { observationOnly?: boolean; identity?: TabControlSessionIdentity } = {},
): Promise<void> {
	// A page observation refines a visible badge; it never creates one. The
	// "untouched page stays hidden" rule is enforced here as well as in the
	// handler so a passive gesture costs no Action IPC at all.
	if (options.observationOnly && !await isBadgeProjected(snapshot.tabId)) return;
	const identity = options.identity
		?? await currentIdentity(snapshot.tabId).catch(() => null);
	if (!identity || identity.documentId !== snapshot.documentId
		|| identity.origin !== snapshot.origin) return;
	// A page observation carries the fields the page itself touched, and the
	// volume it reports is the page's own 0-100 level. The acknowledged
	// multiplier that makes that level audible lives in the durable row, not in
	// the sample: reading the sample alone painted the unamplified number and
	// the badge jumped between the base volume and the effective one.
	const durable = options.observationOnly && !projection
		? await storage.tabSession.get(snapshot.tabId, identity).catch(() => null)
		: null;
	const session = await getAudioSession(snapshot.tabId).catch(() => null);
	// Session persistence may finish after a newer page observation. Preferences
	// only fill unknown fields; the current accepted snapshot owns actual values.
	const latest = snapshots.get(snapshot.tabId) ?? snapshot;
	if (latest.documentId !== snapshot.documentId || latest.generation !== snapshot.generation
		|| latest.origin !== snapshot.origin) return;
	const resolved = { ...(projection ?? durable ?? {}), ...projectControlSessionPatch(latest.fields) };
	const isCaptureActive = audioSessionMatchesControlDocument(session, latest)
		&& isActiveCaptureLifecycle(session);
	await updateBadgeFromControlProjection(latest, resolved, isCaptureActive, false, latest.revision);
}

async function persistControlProjection(
	snapshot: ControlSnapshot,
	changedFields: ControlFieldStates,
	acknowledgedSessionPatch: ControlSessionPatch = {},
	scope: TabControlSessionScope | 'none' = 'none',
	expectedEpoch = navigationEpoch(snapshot.tabId),
): Promise<void> {
	if (scope === 'none') {
		// Automatic restoration changes physical actuals without creating a new
		// preference. Persistence scope must not suppress the existing badge's
		// projection of the accepted snapshot.
		if (Object.keys(changedFields).some((field) => AUDIO_PROJECTION_FIELDS.has(field as ControlField))) {
			await projectBadgeFromSnapshot(snapshot, undefined, { observationOnly: true });
		}
		return;
	}
	assertNavigationFence(snapshot.tabId, expectedEpoch, snapshot);
	const sessionPatch = {
		...projectControlSessionPatch(changedFields),
		...structuredClone(acknowledgedSessionPatch),
	};
	if (Object.keys(sessionPatch).length === 0) return;
	const identity = await currentIdentity(snapshot.tabId);
	assertNavigationFence(snapshot.tabId, expectedEpoch, snapshot);
	if (identity.documentId !== snapshot.documentId || identity.origin !== snapshot.origin) {
		throw new Error('Control projection belongs to a stale document resource');
	}
	// The resource row describes this document completely — including values the
	// page itself set — because that is what an exact-resource reload replays.
	// What it must never do is turn a page's boot-time silence into a preference:
	// `rebindTabControlSession` drops an orphan `mediaMuted: true` or
	// `volumeBase: 0` that no extension gesture promoted to the portable row.
	const retainedResource = scope === 'resource'
		? await storage.tabSession.get(snapshot.tabId, identity).catch(() => null) : null;
	assertNavigationFence(snapshot.tabId, expectedEpoch, snapshot);
	const currentResourcePatch = {
		...retainedResource,
		...projectControlSessionPatch(snapshot.fields),
		...structuredClone(acknowledgedSessionPatch),
	};
	await storage.tabSession.merge(
		snapshot.tabId,
		sessionPatch,
		identity,
		scope,
		currentResourcePatch,
	);
	assertNavigationFence(snapshot.tabId, expectedEpoch, snapshot);
	if (!Object.keys(sessionPatch).some((field) => AUDIO_PROJECTION_FIELDS.has(field as ControlField))) return;
	const completeSession = await storage.tabSession.get(snapshot.tabId, identity)
		.catch(() => null) ?? sessionPatch;
	await projectBadgeFromSnapshot(snapshot, completeSession, { identity, observationOnly: scope === 'resource' });
	assertNavigationFence(snapshot.tabId, expectedEpoch, snapshot);
}

// Chrome clears a tab-scoped Action projection during full navigation. Rebuild
// it only after the document initialization barrier has restored the current
// acknowledged session; the badge remains a projection, never another owner.
async function reprojectBadgeForCurrentDocument(tabId: number): Promise<void> {
	// Chrome owns the visible projection and has just cleared it; nothing cached
	// from before this call describes the screen any more.
	invalidatePaintedBadge(tabId);
	const snapshot = await getSnapshot(tabId);
	if (!snapshot) {
		await restoreBadgeUsageForTab(tabId);
		return;
	}
	const identity = await currentIdentity(tabId).catch(() => null);
	if (!identity
		|| identity.documentId !== snapshot.documentId
		|| identity.origin !== snapshot.origin) {
		await restoreBadgeUsageForTab(tabId);
		return;
	}
	const completeSession = await storage.tabSession.get(tabId, identity)
		.catch(() => null) ?? projectControlSessionPatch(snapshot.fields);
	await projectBadgeFromSnapshot(snapshot, completeSession, { identity });
}

interface PreparedControlIntent {
	audioVolume?: ControlApplyAck['audioVolume'];
	intent: ControlIntent;
	baseline: ControlSnapshot;
	ackTarget: MediaTarget | null;
	activeMedia: ControlSnapshot['activeMedia'];
	activeVideo: ControlSnapshot['activeVideo'];
	fields: ControlFieldStates;
	mediaObservation?: MediaObservationStamp;
}

interface CommitControlProjection extends Pick<PhysicalPublication, 'live' | 'liveTarget'> {
	observation?: boolean;
	acknowledgementTarget?: MediaTarget | null;
	activeVideo?: ControlSnapshot['activeVideo'];
	acknowledgedSessionPatch?: ControlSessionPatch;
	sessionScope?: TabControlSessionScope | 'none';
	mediaObservation?: MediaObservationStamp;
}

// post: distinguishes a rejected base revision (retryable after a snapshot
// refresh) from persistent control failures so UI callers can recover the
// user's explicit intent instead of dropping it on a content-runtime race.
export class StaleControlRevisionError extends Error {
	readonly expectedRevision: number;

	constructor(expectedRevision: number) {
		super(`Stale control revision: expected ${expectedRevision}`);
		this.name = 'StaleControlRevisionError';
		this.expectedRevision = expectedRevision;
	}
}

class NativeControlExecutionError extends Error {
	constructor(readonly code: string, message: string) {
		super(`${code}: ${message}`);
		this.name = 'NativeControlExecutionError';
	}
}

async function prepareIntent(
	request: RoutedControlSubmitRequest,
	contextSnapshot?: ControlSnapshot,
	intentId?: string,
): Promise<PreparedControlIntent> {
	const snapshot = contextSnapshot ?? await getOrCreateSnapshot(request.tabId);
	if (request.baseRevision !== undefined && request.baseRevision !== snapshot.revision) {
		throw new StaleControlRevisionError(snapshot.revision);
	}
	if (request.target && request.target.documentId !== snapshot.documentId) {
		throw new Error('The selected media target belongs to a stale document');
	}
	if (request.source === 'page' && request.target === null
		&& request.observationDocumentId !== snapshot.documentId) {
		throw new Error('The bootstrap observation belongs to a stale document');
	}
	if (request.source === 'page') assertMediaAcknowledgementCurrent(snapshot, request.target, request.mediaObservation,
		nativeObservationFields({ patch: request.patch ?? {}, observedStrategies: request.observedStrategies ?? {} }, snapshot.revision));

	const resolvedRequest = await resolveSubmitRequest(snapshot, request);
	const intent = createIntent(snapshot, resolvedRequest, intentId ?? crypto.randomUUID());
	const pageObservation = intent.source === 'page';
	const chromeResult = pageObservation
		? { remaining: {}, fields: applyPageObservation(intent, resolvedRequest.observedStrategies) }
		: await applyChromeFields(intent);
	let fields: ControlFieldStates = { ...chromeResult.fields };
	let ackTarget = intent.target;
	let audioVolume: ControlApplyAck['audioVolume'];
	let mediaObservation = request.mediaObservation;
	let activeMedia = snapshot.activeMedia;
	let activeVideo = snapshot.activeVideo;
	if (pageObservation) {
		({ activeMedia, activeVideo } = projectControlTarget(
			snapshot,
			Object.keys(intent.patch) as ControlCapability[],
			intent.target,
		));
	}
	if (pageObservation && snapshot.fields.volumeBase?.strategy !== 'capture' && typeof intent.patch.volumeBase === 'number'
		&& volumeObservationCanNormalize(snapshot, request.mediaObservation)) {
		const knownBoost = snapshot.fields.boost?.actual;
		const session = typeof knownBoost === 'number'
			? null
			: await getAudioSession(snapshot.tabId).catch(() => null);
		const sessionMatches = session?.documentId === snapshot.documentId
			&& session.origin === snapshot.origin
			&& session.generation === snapshot.generation;
		const currentBoost = typeof knownBoost === 'number'
			? knownBoost
			: sessionMatches
				? resolveAudioVolume(session.actualConfig).boost
				: 1;
		if (currentBoost !== 1) {
			// A page-side volume gesture owns the public effective-volume value. Reset
			// the hidden processor multiplier once, in the same coordinator commit,
			// so page 50% can never be projected as stale 50% x old Boost.
			const normalizationIntent: ControlIntent = {
				...intent,
				source: 'system',
				requestedCoverage: 'full',
				actualContext: { ...intent.actualContext, volumeBase: intent.patch.volumeBase },
				patch: { boost: 1 },
			};
			const response = await sendSpectraTabRequest(
				intent.tabId,
				'spectra.control.intent.execute',
				normalizationIntent,
				{ documentId: intent.documentId, generation: intent.generation },
			).catch(() => null);
			if (response?.ok
				&& response.data.intentId === intent.intentId
				&& response.data.documentId === intent.documentId
				&& response.data.generation === intent.generation
				&& response.data.revision === intent.baseRevision + 1) {
				fields = { ...fields, ...response.data.fields };
			} else {
				const existingStrategy = snapshot.fields.boost?.strategy;
				const strategy = existingStrategy === 'capture'
					? 'capture'
					: sessionMatches && session.actualMode === 'capture'
						? 'capture'
						: 'unsupported';
				fields.boost = {
					desired: 1,
					actual: currentBoost,
					revision: intent.baseRevision + 1,
					phase: 'error',
					strategy,
					coverage: 'full',
					controlled: strategy === 'capture',
					intentId: intent.intentId,
					lastError: {
						code: 'strategy-runtime-failed',
						message: response?.ok
							? 'The processor returned a stale Boost reset acknowledgement'
							: response && !response.ok
								? response.error.message
								: 'The processor did not acknowledge the Boost reset',
						retryable: true,
					},
				};
			}
		}
	}
	const routedPatch: ControlPatch = pageObservation ? {} : chromeResult.remaining;
	if (Object.keys(routedPatch).length > 0) {
		// Page observations never echo a second DOM write. The only processor work
		// they may cause is the one-shot hidden Boost normalization above.
		const routedIntent: ControlIntent = {
			...intent,
			source: pageObservation ? 'system' : intent.source,
			patch: routedPatch,
		};
		const response = await sendSpectraTabRequest(
			intent.tabId,
			'spectra.control.intent.execute',
			routedIntent,
			{ documentId: intent.documentId, generation: intent.generation },
		);
		if (!response.ok) throw new NativeControlExecutionError(response.error.code, response.error.message);
		if (!controlApplyAckMatches(response.data, intent)) {
			throw new Error('Content runtime returned a stale control ACK');
		}
		ackTarget = response.data.target;
		mediaObservation = response.data.mediaObservation;
		audioVolume = response.data.audioVolume;
		({ activeMedia, activeVideo } = projectControlTarget(
			snapshot,
			Object.keys(routedPatch) as ControlCapability[],
			response.data.target,
		));
		fields = {
			...fields,
			...response.data.fields,
		};
	}

	const baseline = await getOrCreateSnapshot(intent.tabId);
	if (baseline.documentId !== intent.documentId
		|| baseline.generation !== intent.generation
		|| baseline.revision !== intent.baseRevision) {
		throw new Error('Control ACK arrived after the document or revision changed');
	}
	assertMediaAcknowledgementCurrent(baseline, ackTarget, mediaObservation, fields);
	fields = mergeMediaObservedFields({}, fields, mediaObservation, false);
	return { intent, baseline, ackTarget, activeMedia, activeVideo, fields, mediaObservation, ...(audioVolume ? { audioVolume } : {}) };
}

async function commitControlFields(
	baseline: ControlSnapshot,
	fields: ControlFieldStates,
	activeMedia: ControlSnapshot['activeMedia'],
	projection: CommitControlProjection = {},
): Promise<ControlSnapshot> {
	const expectedEpoch = snapshotFenceEpochs.get(baseline) ?? navigationEpoch(baseline.tabId);
	assertNavigationFence(baseline.tabId, expectedEpoch, baseline);
	const current = await getOrCreateSnapshot(baseline.tabId);
	if (current.documentId !== baseline.documentId
		|| current.generation !== baseline.generation
		|| current.revision !== baseline.revision) {
		throw new Error('Control transaction lost its document or revision before commit');
	}
	assertNavigationFence(baseline.tabId, expectedEpoch, baseline);
	const revision = baseline.revision + 1;
	const activeVideo = Object.hasOwn(projection, 'activeVideo')
		? projection.activeVideo ?? null
		: activeMedia?.kind === 'video'
			? activeMedia
			: baseline.activeVideo;
	let committed: ControlSnapshot = {
		...current,
		revision,
		activeMedia,
		activeVideo,
		fields: { ...current.fields, ...fields },
	};
	committed = await publishSnapshot(committed, expectedEpoch, { fields, observation: projection.observation, mediaObservation: projection.mediaObservation,
		live: projection.live, liveTarget: projection.liveTarget,
		...(Object.hasOwn(projection, 'acknowledgementTarget') ? { acknowledgementTarget: projection.acknowledgementTarget } : {}) });
	assertNavigationFence(baseline.tabId, expectedEpoch, committed);
	if (Object.entries(fields).some(([field, state]) => RUNTIME_RESIDENT_NATIVE_FIELDS.has(field as ControlField)
		&& state?.phase === 'applied' && state.controlled)) {
		retainMediaIntentRuntimeLease(committed.tabId, committed.documentId);
	}
	await reconcileRuntimeOwnership(committed);
	assertNavigationFence(baseline.tabId, expectedEpoch, committed);
	// The ACK only depends on the memory + snapshot-storage commit and runtime
	// ownership above. The per-origin session projection (badge + durable
	// session fields) is a follow-on durability/UI write: it re-verifies the
	// top document (one getFrame IPC) and performs three storage round trips,
	// so it is scheduled on a per-tab tail after the requester is answered.
	// Write order is preserved; a stale-document failure after navigation is
	// expected and only warned.
	scheduleSessionProjection(committed.tabId, () => persistControlProjection(
		committed,
		fields,
		projection.acknowledgedSessionPatch,
		projection.sessionScope,
		expectedEpoch,
	));
	return committed;
}

async function applyChromeTabObservation(
	tabId: number,
	patch: Pick<ControlPatch, 'tabMuted' | 'tabPinned'>,
): Promise<ControlSnapshot> {
	const baseline = await getOrCreateSnapshot(tabId);
	const fields: ControlFieldStates = {};
	for (const [rawField, actual] of Object.entries(patch)) {
		const field = rawField as 'tabMuted' | 'tabPinned';
		if (typeof actual !== 'boolean') continue;
		const current = baseline.fields[field];
		if (current?.phase === 'applied' && current.actual === actual) continue;
		(fields as Record<string, unknown>)[field] = {
			desired: actual,
			actual,
			revision: baseline.revision + 1,
			phase: 'applied',
			strategy: CONTROL_STRATEGY_CHROME_NATIVE,
			coverage: 'full',
			controlled: false,
			intentId: crypto.randomUUID(),
			lastError: null,
		};
	}
	if (Object.keys(fields).length === 0) return baseline;
	return commitControlFields(baseline, fields, baseline.activeMedia);
}

function observeChromeTabState(
	tabId: number,
	patch: Pick<ControlPatch, 'tabMuted' | 'tabPinned'>,
): Promise<ControlSnapshot> {
	return serialized(tabId, () => applyChromeTabObservation(tabId, patch));
}

// An externally stopped processor invalidates its physical facts. Session
// publication is asynchronous to control execution, so join the same tab lane
// without making Content's publication ACK wait on its own in-flight command.
export function observeStoppedAudioOutput(session: AudioSessionSnapshot): void {
	if (session.actualMode !== 'bypass' || session.phase !== 'error') return;
	void serialized(session.tabId, async () => {
		const current = await getSnapshot(session.tabId);
		if (!current || current.documentId !== session.documentId || current.origin !== session.origin) return;
		const actualSession = await getAudioSession(session.tabId);
		if (!actualSession || actualSession.documentId !== session.documentId || actualSession.origin !== session.origin
			|| actualSession.generation !== session.generation
			|| actualSession.actualMode !== 'bypass' || actualSession.phase !== 'error') return;
		const fields: ControlFieldStates = {};
		for (const [field, state] of Object.entries(current.fields)) {
			if (state?.strategy !== 'capture' || !state.controlled) continue;
			Object.assign(fields, { [field]: { ...state, actual: null, controlled: false, phase: 'error',
				revision: current.revision + 1,
				lastError: { code: 'capability-unavailable', message: 'The document audio processor stopped', retryable: true } } });
		}
		if (Object.keys(fields).length) await commitControlFields(current, fields, current.activeMedia);
	}).catch(error => swLog.warn('Stopped audio output publication failed', error));
}

async function executeIntent(
	request: RoutedControlSubmitRequest,
	contextSnapshot?: ControlSnapshot,
	intentId?: string,
	presentation: Pick<PhysicalPublication, 'live' | 'liveTarget'> = {},
): Promise<ControlApplyAck> {
	const current = contextSnapshot ?? await getOrCreateSnapshot(request.tabId);
	const prepared = await prepareIntent(request, current, intentId);
	const { intent, baseline, ackTarget, activeMedia, activeVideo, fields, mediaObservation } = prepared;
	const committed = await commitControlFields(
		baseline,
		fields,
		activeMedia,
		{
			...presentation,
			activeVideo,
			observation: intent.source === 'page',
			acknowledgementTarget: ackTarget,
			mediaObservation,
			sessionScope: controlSessionScopeForSource(intent.source),
		},
	);
	const audioVolume = prepared.audioVolume ?? resolveControlAudioVolume(committed.fields);
	return {
		intentId: intent.intentId,
		tabId: intent.tabId,
		documentId: intent.documentId,
		generation: intent.generation,
		revision: committed.revision,
		target: ackTarget,
		fields: Object.fromEntries(Object.keys(fields).map((field) => [field, committed.fields[field as ControlField]])) as ControlFieldStates,
		...(committed.mediaObservation ? { mediaObservation: committed.mediaObservation } : {}),
		...(audioVolume ? { audioVolume } : {}),
	};
}

interface ControlActualCapture {
	patch: ControlPatch;
	// The same values restricted to the fields whose writer is known, so a
	// consumer that needs an observation cannot accidentally claim provenance
	// for a value nobody attributed.
	observation: Pick<ControlReadResult, 'patch' | 'observedStrategies'>;
}

async function captureActualPatch(
	snapshot: ControlSnapshot,
	target: ControlSnapshot['activeMedia'],
	fields: readonly ControlDirectField[],
	controlledOnly = false,
): Promise<ControlActualCapture> {
	const patch = snapshotActualPatch(snapshot, fields, controlledOnly);
	const observedStrategies: ControlObservationStrategies = {};
	// A value carried over from the snapshot keeps the strategy it settled with.
	for (const field of Object.keys(patch) as ControlDirectField[]) {
		const strategy = snapshot.fields[field]?.strategy;
		if (isControlObservationStrategy(strategy)) observedStrategies[field] = strategy;
	}
	const response = await sendSpectraTabRequest(
		snapshot.tabId,
		PROTO_ACTUAL_READ,
		{ fields, target },
		{ documentId: snapshot.documentId, generation: snapshot.generation },
	).catch(() => null);
	if (response?.ok) {
		for (const [rawField, value] of Object.entries(response.data.patch)) {
			const field = rawField as ControlField;
			if (controlledOnly && !snapshot.fields[field]?.controlled) continue;
			(patch as Record<string, unknown>)[field] = value;
			const strategy = response.data.observedStrategies[field as ControlDirectField];
			if (isControlObservationStrategy(strategy)) observedStrategies[field as ControlDirectField] = strategy;
			else delete observedStrategies[field as ControlDirectField];
		}
	}
	const observationPatch: ControlPatch = {};
	const observationStrategies: ControlObservationStrategies = {};
	for (const [rawField, strategy] of Object.entries(observedStrategies)) {
		const field = rawField as ControlDirectField;
		const value = (patch as Record<string, unknown>)[field];
		if (value === undefined) continue;
		(observationPatch as Record<string, unknown>)[field] = value;
		observationStrategies[field] = strategy;
	}
	return { patch, observation: { patch: observationPatch, observedStrategies: observationStrategies } };
}

interface CompensationResult {
	ok: boolean;
	fields: ControlFieldStates;
	error: string | null;
}

async function compensateControlPatch(
	baseline: ControlSnapshot,
	target: ControlSnapshot['activeMedia'],
	targetPatch: ControlPatch,
	processorPatch: ControlPatch,
	order: readonly ('target' | 'processor')[] = ['target', 'processor'],
): Promise<CompensationResult> {
	const fields: ControlFieldStates = {};
	const failures: string[] = [];
	const isolatedTargetPatch: ControlPatch = { ...targetPatch };
	const isolatedProcessorPatch: ControlPatch = { ...processorPatch };
	if (baseline.fields.volumeBase?.strategy === 'capture') {
		for (const field of ['volumeBase', 'mediaMuted'] as const) {
			if (isolatedTargetPatch[field] !== undefined) {
				Object.assign(isolatedProcessorPatch, { [field]: isolatedTargetPatch[field] });
				delete isolatedTargetPatch[field];
			}
		}
	}
	const stages = {
		target: [isolatedTargetPatch, CONTROL_COVERAGE_TARGET],
		processor: [isolatedProcessorPatch, 'full'],
	} as const;
	for (const stage of order) {
		const [patch, requestedCoverage] = stages[stage];
		if (Object.keys(patch).length === 0) continue;
		try {
			const prepared = await prepareIntent({
				tabId: baseline.tabId,
				source: 'restore',
				requestedCoverage,
				target,
				patch,
			}, baseline);
			Object.assign(fields, prepared.fields);
			assertAppliedPatch(prepared.fields, patch, 'Compensating rollback');
		} catch (error) {
			failures.push(error instanceof Error ? error.message : String(error));
		}
	}
	return {
		ok: failures.length === 0,
		fields,
		error: failures.length === 0 ? null : failures.join('; '),
	};
}

async function commitCompensationFailure(
	baseline: ControlSnapshot,
	target: ControlSnapshot['activeMedia'],
	rollbackPatch: ControlPatch,
	compensation: CompensationResult,
	originalError: unknown,
): Promise<void> {
	const message = originalError instanceof Error ? originalError.message : String(originalError);
	const intentId = crypto.randomUUID();
	const fields: ControlFieldStates = {};
	for (const [rawField, expected] of Object.entries(rollbackPatch)) {
		const field = rawField as ControlField;
		const rollbackState = compensation.fields[field];
		const previous = baseline.fields[field];
		(fields as Record<string, unknown>)[field] = {
			desired: previous?.desired ?? expected,
			actual: rollbackState?.actual ?? null,
			revision: baseline.revision + 1,
			phase: 'error',
			strategy: rollbackState?.strategy ?? previous?.strategy ?? 'unsupported',
			coverage: rollbackState?.coverage ?? previous?.coverage ?? 'partial',
			controlled: false,
			intentId,
			lastError: {
				code: 'transaction-rollback-failed',
				message: `${message}; rollback: ${compensation.error ?? 'unknown failure'}`,
				retryable: true,
			},
		};
	}
	await commitControlFields(baseline, fields, target);
}

interface PreparedContentOperation {
	intent: ControlOperationIntent;
	baseline: ControlSnapshot;
	acknowledgement: ControlOperationAck;
}

async function prepareContentOperation(
	request: RoutedControlOperationRequest,
	operationId: string,
	contextSnapshot?: ControlSnapshot,
): Promise<PreparedContentOperation> {
	const snapshot = contextSnapshot ?? await getOrCreateSnapshot(request.tabId);
	const intent = operationIntent(snapshot, request, operationId);
	const response = await sendSpectraTabRequest(
		request.tabId,
		'spectra.control.operation.execute',
		intent,
		{ documentId: intent.documentId, generation: intent.generation },
	);
	if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
	const ack = response.data;
	if (!controlOperationAckMatches(ack, intent)) {
		throw new Error('Content runtime returned a stale control operation ACK');
	}
	const current = await getOrCreateSnapshot(request.tabId);
	if (current.documentId !== intent.documentId
		|| current.generation !== intent.generation
		|| current.revision !== intent.baseRevision) {
		throw new Error('Control operation ACK arrived after the document or revision changed');
	}
	assertMediaAcknowledgementCurrent(current, ack.target, ack.mediaObservation, ack.fields);
	return { intent, baseline: current, acknowledgement: ack };
}

async function commitContentOperation(
	prepared: PreparedContentOperation,
	source: ControlOperationIntent['source'],
): Promise<ControlOperationAck> {
	const { intent, baseline, acknowledgement } = prepared;
	const projection = intent.operation === 'ab-clear' && source === 'restore'
		? { activeMedia: baseline.activeMedia, activeVideo: baseline.activeVideo }
		: projectControlTarget(baseline, [intent.operation], acknowledgement.target);
	const committed = await commitControlFields(
		baseline,
		acknowledgement.fields,
		projection.activeMedia,
		{
			activeVideo: projection.activeVideo,
			acknowledgementTarget: acknowledgement.target,
			mediaObservation: acknowledgement.mediaObservation,
			sessionScope: controlSessionScopeForSource(source),
		},
	);
	if (committed.revision !== intent.baseRevision + 1) {
		throw new Error('Control operation committed an unexpected revision');
	}
	return { ...acknowledgement, revision: committed.revision,
		fields: Object.fromEntries(Object.keys(acknowledgement.fields).map((field) => [field, committed.fields[field as ControlField]])) as ControlFieldStates,
		...(acknowledgement.operation === 'playback-toggle' && typeof committed.fields.playing?.actual === 'boolean'
			? { result: { playing: committed.fields.playing.actual } } : {}),
		...(committed.mediaObservation ? { mediaObservation: committed.mediaObservation } : {}),
	} as ControlOperationAck;
}

async function routeContentOperation(
	request: RoutedControlOperationRequest,
	operationId: string,
): Promise<ControlOperationAck> {
	const acknowledgement = await commitContentOperation(
		await prepareContentOperation(request, operationId),
		request.source,
	);
	reconcileOperationSourceOwnership(acknowledgement);
	return acknowledgement;
}

function reconcileOperationSourceOwnership(ack: ControlOperationAck): void {
	const target = ack.target;
	if (!target) return;
	if (ack.operation === 'marker-add') {
		if (ack.result.remaining > 0) retainSourceRuntimeLease(ack.tabId, target, 'marker');
		return;
	}
	if (ack.operation === 'marker-remove') {
		if (ack.result.remaining === 0) releaseSourceRuntimeLease(ack.tabId, target, 'marker');
		return;
	}
	if (ack.operation === 'ab-set-a' || ack.operation === 'ab-set-b') {
		retainSourceRuntimeLease(ack.tabId, target, 'ab');
		return;
	}
	if (ack.operation === 'ab-clear') releaseSourceRuntimeLease(ack.tabId, target, 'ab');
}

async function handleSourceReleased(
	tabId: number,
	target: MediaTarget,
	mediaObservation?: MediaObservationStamp,
): Promise<void> {
	const snapshot = await getSnapshot(tabId);
	if (!snapshot || snapshot.documentId !== target.documentId) return;
	const ownsActiveSource = snapshot.activeMedia?.mediaId === target.mediaId
		&& snapshot.activeMedia.sourceRevision === target.sourceRevision;
	const ownsActiveVideo = snapshot.activeVideo?.mediaId === target.mediaId
		&& snapshot.activeVideo.sourceRevision === target.sourceRevision;
	const canReplace = mediaSampleCanReplace(snapshot, mediaObservation);
	if (snapshot.mediaObservation && (!mediaObservation
		|| mediaObservation.epoch < snapshot.mediaObservation.epoch
		|| mediaObservation.epoch === snapshot.mediaObservation.epoch && mediaObservation.owner !== snapshot.mediaObservation.owner)) return;
	if (!canReplace && (ownsActiveSource || ownsActiveVideo)) return;
	releaseSourceRuntimeLease(tabId, target, 'marker');
	releaseSourceRuntimeLease(tabId, target, 'ab');
	retiredMediaSources.set(mediaSourceKey(tabId, target), mediaObservation?.epoch ?? 0);
	if (!canReplace) return;
	const ab = snapshot.fields.abLoop;
	if (!ownsActiveSource && !ownsActiveVideo
		&& (!ab || ab.phase === 'idle' || !ab.controlled)) return;
	const intentId = crypto.randomUUID();
	const fields: ControlFieldStates = { ...retireMediaActualFields(snapshot.fields, ownsActiveSource, ownsActiveVideo, snapshot.revision),
		...(ab && (ownsActiveSource || snapshot.activeMedia === null)
		? {
			abLoop: {
				desired: null,
				actual: { pointA: null, pointB: null, enabled: false },
				revision: snapshot.revision,
				phase: 'idle',
				strategy: CONTROL_STRATEGY_EXTENSION,
				coverage: CONTROL_COVERAGE_TARGET,
				controlled: false,
				intentId,
				lastError: null,
			},
		}
		: {}),
	};
	if (mediaObservation) {
		for (const field of Object.values(fields)) if (field) field.mediaObservation = mediaObservation;
	}
	await publishSnapshot({ ...snapshot, fields: { ...snapshot.fields, ...fields },
		activeMedia: ownsActiveSource ? null : snapshot.activeMedia,
		activeVideo: ownsActiveVideo ? null : snapshot.activeVideo,
	}, navigationEpoch(tabId), { fields, mediaObservation, observation: true });
}

async function handleTargetChanged(
	tabId: number,
	target: import('@nexus/contracts').MediaTarget,
	mediaObservation?: MediaObservationStamp,
): Promise<void> {
	let baseline = await getOrCreateSnapshot(tabId);
	if (target.frameId !== 0 || target.documentId !== baseline.documentId) {
		throw new Error('Active media selection belongs to a stale or unsupported frame');
	}
	if (mediaObservation) {
		if (!mediaSampleCanReplace(baseline, mediaObservation) || isRetiredMediaSample(tabId, target, mediaObservation)) return;
		baseline = await admitPhysicalObservation(baseline, { target, patch: {}, observedStrategies: {}, mediaObservation });
		const response = await readSpectraTabPassively(tabId, PROTO_ACTUAL_READ,
			{ fields: [...PAGE_OBSERVABLE_FIELDS] as ControlDirectField[], target },
			{ documentId: baseline.documentId, generation: baseline.generation });
		if (response.ok) {
			// The document owns its current resource. A revision that advanced
			// between the announcement and this passive read is still the same
			// control target, and a page that swapped players has already moved to
			// the successor. Requiring the readback to equal the announced target
			// left the projection on the retired source and failed the viewer's
			// first write after a stream swap (SP-22.3 §1/§2).
			const authoritative = response.data.target;
			if (authoritative && authoritative.documentId === baseline.documentId
				&& authoritative.frameId === 0
				&& !isRetiredMediaSample(tabId, authoritative, response.data.mediaObservation)) {
				await admitPhysicalObservation(baseline, response.data);
			}
		}
		return;
	}
	if (baseline.mediaObservation) return;
	if (sameMediaTarget(baseline.activeMedia, target)
		&& (target.kind !== 'video' || sameMediaTarget(baseline.activeVideo, target))) return;
	const response = await sendSpectraTabRequest(
		tabId,
		PROTO_ACTUAL_READ,
		{
			fields: [...PAGE_OBSERVABLE_FIELDS] as ControlDirectField[],
			target,
		},
		{ documentId: baseline.documentId, generation: baseline.generation },
	);
	if (!response.ok || !sameMediaTarget(response.data.target, target)) {
		throw new Error(response.ok
			? 'Active media readback resolved a different source'
			: `${response.error.code}: ${response.error.message}`);
	}
	const fields = nativeObservationFields(
		response.data,
		baseline.revision + 1,
	);
	await commitControlFields(
		baseline,
		fields,
		target,
		{ sessionScope: 'resource' },
	);
}

async function commitBackgroundOperation<O extends Extract<
	ControlOperationRequest['operation'],
	'open-popup' | 'open-options' | 'open-url' | 'run-user-script'
>>(
	request: RoutedControlOperationRequest & { operation: O },
	operationId: string,
	strategy: 'chrome-native' | 'extension-state',
	result: ControlOperationResult<O>,
	expected: Pick<ControlSnapshot, 'documentId' | 'generation'>,
): Promise<ControlOperationAck<O>> {
	const current = await getOrCreateSnapshot(request.tabId);
	if (current.documentId !== expected.documentId || current.generation !== expected.generation) {
		throw new Error('Background operation completed after its target document changed');
	}
	const expectedEpoch = snapshotFenceEpochs.get(current) ?? navigationEpoch(request.tabId);
	assertNavigationFence(request.tabId, expectedEpoch, current);
	const revision = current.revision + 1;
	const committed = { ...current, revision };
	await publishSnapshot(committed, expectedEpoch);
	const acknowledgement: ControlOperationAck<O> = {
		operationId,
		tabId: request.tabId,
		documentId: committed.documentId,
		generation: committed.generation,
		revision,
		// Extension UI, URL and sandbox operations do not own a media source.
		// Returning the active media here would falsely project a media-scoped ACK
		// into Popup/remote reducers even though no media writer ran.
		target: null,
		operation: request.operation,
		strategy,
		coverage: 'full',
		fields: {},
		result,
	};
	return acknowledgement;
}

async function currentOperationTab(
	tabId: number,
	documentId: string,
): Promise<chrome.tabs.Tab> {
	const identity = await currentIdentity(tabId);
	if (identity.documentId !== documentId) {
		throw new Error('Background operation belongs to a stale document');
	}
	const tab = await chrome.tabs.get(tabId);
	if (tab.id !== tabId || !Number.isInteger(tab.windowId)) {
		throw new Error('Background operation target tab is unavailable');
	}
	return tab;
}

function normalizeHttpUrl(value: string): string {
	if (value.length === 0 || value.length > 8_192) throw new Error('Invalid URL');
	const url = new URL(value);
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error('Only HTTP(S) URLs may be opened');
	}
	return url.href;
}

function createFieldOperationAck<
	O extends Extract<
		ControlOperationRequest['operation'],
		'playback-toggle' | 'seek-relative' | 'video-effects-toggle' | 'video-effects-reset' | 'effective-volume'
	>,
	F extends ControlDirectField,
>(
	operationId: string,
	operation: O,
	fieldAck: ControlApplyAck,
	field: F,
	result: ControlOperationResult<O>,
	strategy?: ControlStrategy,
	coverage?: ControlCoverage,
): ControlOperationAck<O> {
	const state = fieldAck.fields[field];
	return {
		operationId,
		tabId: fieldAck.tabId,
		documentId: fieldAck.documentId,
		generation: fieldAck.generation,
		revision: fieldAck.revision,
		target: fieldAck.target,
		operation,
		strategy: strategy ?? state?.strategy ?? 'unsupported',
		coverage: coverage ?? state?.coverage ?? 'partial',
		fields: fieldAck.fields,
		...(fieldAck.audioVolume ? { audioVolume: fieldAck.audioVolume } : {}),
		result,
	} as ControlOperationAck<O>;
}

// A starting player can retire more than one source before settling. Keep the
// original scalar gesture in this queue slot across a finite number of distinct
// source identities; never require another user gesture to consume the next one.
const MAX_NATIVE_VOLUME_SOURCE_RECOVERIES = 3;
const NATIVE_VOLUME_SOURCE_SETTLE_DELAYS_MS = [25, 75, 150] as const;
const NATIVE_VOLUME_SOURCE_RECOVERY_BUDGET_MS = 1_000;

// Internal presentation observer, never a wire input or another volume planner.
// The serialized operation owns the physical baseline and the absolute goal.
export type ControlVolumePlanObserver = (plan: {
	snapshot: ControlSnapshot; volume: number; muted: boolean;
}) => Promise<void>;

async function executeFieldOperation(
	request: RoutedControlOperationRequest,
	operationId: string,
	volumeRecovery?: { baseline: ControlSnapshot; target: MediaTarget | null; error: NativeControlExecutionError; attempts: number; deadline: number },
	onVolumePlan?: ControlVolumePlanObserver,
): Promise<ControlOperationAck> {
	const common = {
		tabId: request.tabId,
		source: request.source,
		target: request.target,
		...(request.captureAdmission
			? { captureAdmission: request.captureAdmission }
			: {}),
	} as const;
	if (request.operation === 'effective-volume') {
		const baseline = await getOrCreateSnapshot(request.tabId);
		if (volumeRecovery) {
			if (performance.now() >= volumeRecovery.deadline) throw volumeRecovery.error;
			assertNavigationFence(request.tabId, snapshotFenceEpochs.get(volumeRecovery.baseline)
				?? navigationEpoch(request.tabId), volumeRecovery.baseline);
			const identity = await currentIdentity(request.tabId);
			if (identity.documentId !== volumeRecovery.baseline.documentId
				|| baseline.documentId !== volumeRecovery.baseline.documentId
				|| baseline.generation !== volumeRecovery.baseline.generation) throw volumeRecovery.error;
		}
		const snapshotActual = (field: 'volumeBase' | 'boost'): number | null => {
			const actual = baseline.fields[field]?.actual;
			return typeof actual === 'number' ? actual : null;
		};
		const knownVolumeBase = snapshotActual('volumeBase');
		const knownBoost = snapshotActual('boost');
		const knownMuted = baseline.fields.mediaMuted?.actual;
		const readFields = [
			'volumeBase' as const,
			'mediaMuted' as const,
			...(knownBoost === null || volumeRecovery ? ['boost' as const] : []),
		];
		// The snapshot may outlive its Content registry. Resolve an implicit
		// target in the current runtime and read its native pair atomically before
		// planning: reusing a previous media ID can write a hidden replacement or
		// strand every gesture on a target that no longer exists. Processor ACKs
		// remain owned by their existing lifecycle, not a native getter sample.
		const readVolume = () => sendSpectraTabRequest(
				request.tabId,
				PROTO_ACTUAL_READ,
				{ fields: readFields, target: request.target },
				{ documentId: baseline.documentId, generation: baseline.generation },
			).catch(() => null);
		let readback = await readVolume();
		// Only a newly resolved source proves that this gesture can continue.
		// Retirement and insertion need not share a browser task. A read in that
		// gap is not a terminal user failure: allow bounded, read-only settlement
		// before deciding, with no writer until a distinct complete target exists.
		if (volumeRecovery) {
			const replacementReady = () => readback?.ok && readback.data.target
				&& readback.data.target.documentId === baseline.documentId
				&& typeof readback.data.patch.volumeBase === 'number'
				&& typeof readback.data.patch.mediaMuted === 'boolean'
				&& typeof readback.data.patch.boost === 'number'
				&& !sameMediaTarget(readback.data.target, volumeRecovery.target);
			for (const delay of NATIVE_VOLUME_SOURCE_SETTLE_DELAYS_MS) {
				if (replacementReady()) break;
				if (performance.now() + delay >= volumeRecovery.deadline) throw volumeRecovery.error;
				// A completed read can witness a mounting gap. A failed transport
				// cannot: repeating its full RPC deadline would strand the gesture.
				if (!readback?.ok || readback.data.target && readback.data.target.documentId !== baseline.documentId) {
					throw volumeRecovery.error;
				}
				await new Promise<void>((resolve) => setTimeout(resolve, delay));
				assertNavigationFence(request.tabId, snapshotFenceEpochs.get(volumeRecovery.baseline)
					?? navigationEpoch(request.tabId), volumeRecovery.baseline);
				const identity = await currentIdentity(request.tabId);
				if (identity.documentId !== volumeRecovery.baseline.documentId) throw volumeRecovery.error;
				readback = await readVolume();
			}
			if (performance.now() >= volumeRecovery.deadline || !replacementReady()) throw volumeRecovery.error;
			if (!readback?.ok || readback.data.patch.boost !== 1
				|| readback.data.observedStrategies.volumeBase === 'capture'
				|| readback.data.nativeAudioAbsent && readback.data.observedStrategies.volumeBase !== 'page-native') {
				throw volumeRecovery.error;
			}
		}
		const knownTarget = request.target ?? baseline.activeMedia;
		// Refresh improves target selection, but main did not make a warm volume
		// control depend on this extra read. Retain the current-document writer
		// when its complete baseline exists; its own target fencing and physical
		// ACK still decide success. Cold/other-target requests cannot borrow it.
		if (!readback?.ok && (knownVolumeBase === null || knownBoost === null
			|| typeof knownMuted !== 'boolean' || !knownTarget
			|| !sameMediaTarget(knownTarget, baseline.activeMedia))) {
			throw new Error(readback ? readback.error.message : 'Current volume could not be read');
		}
		const actualField = <K extends 'volumeBase' | 'boost'>(field: K): number | null => {
			const direct = readback?.ok ? readback.data.patch[field] : undefined;
			if (typeof direct === 'number') return direct;
			const known = field === 'volumeBase' ? knownVolumeBase : knownBoost;
			return known;
		};
		const currentVolumeBase = actualField('volumeBase') ?? CONTROL_VALUE_LIMITS.volumeBase.max;
		const observedVolumeStrategy = readback?.ok
			? readback.data.observedStrategies.volumeBase : baseline.fields.volumeBase?.strategy;
		const documentOutput = readback?.ok && readback.data.nativeAudioAbsent === true && observedVolumeStrategy !== 'page-native'
			|| observedVolumeStrategy === 'capture';
		const unownedDocumentOutput = documentOutput && observedVolumeStrategy !== 'capture';
		const current = {
			volumeBase: unownedDocumentOutput ? 100 : currentVolumeBase,
			boost: actualField('boost') ?? 1,
		};
		// The processor owns the amplified scale while its boost field is
		// applied and controlled: a live capture/webaudio session is the only
		// way boost can be controlled (neutral/disabled releases are not).
		// A held processor sits at a neutral gain (boost === 1) yet still owns
		// the scale: up-crosses must skip the cold page-native probe and stay
		// pure gain updates.
		const processorOwnsScale = baseline.fields.boost?.phase === 'applied'
			&& baseline.fields.boost?.controlled === true;
		const observedMuted = readback?.ok ? readback.data.patch.mediaMuted : undefined;
		const currentMuted = unownedDocumentOutput ? false : typeof observedMuted === 'boolean'
			? observedMuted
			: typeof knownMuted === 'boolean'
				? knownMuted
				: null;
		const currentEffective = compileEffectiveVolume(current.volumeBase, current.boost);
		const desiredEffective = request.payload.operation === 'delta'
			? stepEffectiveVolume(currentEffective, request.payload.value)
			: clampControlValue(request.payload.value, 'volume', currentEffective);
		let desired = desiredEffective > CONTROL_VALUE_LIMITS.volumeBase.max
			&& current.boost === 1
			&& current.volumeBase > CONTROL_VALUE_LIMITS.volumeBase.max
			? { volumeBase: desiredEffective, boost: 1 }
			: splitEffectiveVolume(desiredEffective);
		let target = readback?.ok ? readback.data.target : request.target ?? baseline.activeMedia;
		// The read proves this kind only for its exact source. Publication still
		// checks it against the target physically acknowledged by the writer.
		const presentation = readback?.ok && typeof readback.data.live === 'boolean'
			? { live: readback.data.live, liveTarget: readback.data.target } : {};
		// A warm writer may proceed without this optional read, but presentation
		// cannot borrow the previous source's prospective route as fresh proof.
		await onVolumePlan?.({ snapshot: { ...baseline, activeMedia: target,
			prospectiveBoostRoute: readback?.ok ? readback.data.prospectiveBoostRoute : null }, volume: desiredEffective,
			muted: desiredEffective > 0 ? false : currentMuted ?? false });
		if (documentOutput && request.target === null) {
			const fieldAck = await executeIntent({
				...common, target, requestedCoverage: 'full',
				patch: { ...desired, mediaMuted: desiredEffective > 0 ? false : currentMuted ?? false },
			}, baseline, undefined, presentation);
			assertAppliedFields(fieldAck.fields, ['volumeBase', 'boost', 'mediaMuted'], 'Document output volume');
			const volumeBase = fieldAck.fields.volumeBase?.actual;
			const boost = fieldAck.fields.boost?.actual;
			if (typeof volumeBase !== 'number' || typeof boost !== 'number') throw new Error('Missing output volume readback');
			return createFieldOperationAck(operationId, request.operation, fieldAck, 'volumeBase', {
				effectiveVolume: compileEffectiveVolume(volumeBase, boost), volumeBase, boost,
			}, CONTROL_STRATEGY_EXTENSION, 'opaque');
		}
		// Without a fresh read, even an equal requested value needs a writer ACK;
		// the cached value is a planning baseline, never evidence of completion.
		const volumeStagePatch: ControlPatch = !volumeRecovery && readback?.ok && current.volumeBase === desired.volumeBase
			? {}
			: { volumeBase: desired.volumeBase };
		// The public control is the level the viewer hears, not a muted element's
		// hidden property. A page that starts muted — autoplay policy, a player
		// parked at zero, a pre-roll that muted the broadcast — turns every volume
		// gesture into a number that moves while nothing becomes audible, which is
		// indistinguishable from a broken control. Raising the level is therefore
		// also a request to hear it: the same transaction releases the mute.
		//
		// This is not a preference replay. It only runs while a gesture is being
		// served, never on restore, and a document that has never been interacted
		// with still refuses the unmute (the browser owns that admission); the
		// mute then stays a page fact instead of a failure of the volume write.
		const releaseMute = desiredEffective > 0 && currentMuted === true;
		const targetPatch: ControlPatch = releaseMute
			? { ...volumeStagePatch, mediaMuted: false }
			: volumeStagePatch;
		// A cold processor read proves the scalar value but not the processor
		// lifecycle strategy required by ControlSnapshot. Route one exact no-op
		// intent through the processor owner so later volume/mute ACKs can project
		// a complete value + lifecycle pair without consulting session storage.
		const processorPatch: ControlPatch = current.boost === desired.boost
			&& knownBoost !== null
			? {}
			: { boost: desired.boost };
		const stageOrder: readonly ('target' | 'processor')[] = current.boost !== 1
			&& desired.boost === 1
			&& Object.keys(targetPatch).length > 0
			? ['processor', 'target']
			: ['target', 'processor'];

		// Equal current physical values need no setter or synthetic revision.
		// A historical snapshot alone cannot certify this no-op across a reload.
		if (Object.keys(targetPatch).length === 0 && Object.keys(processorPatch).length === 0) {
			return {
				operationId,
				tabId: request.tabId,
				documentId: baseline.documentId,
				generation: baseline.generation,
				revision: baseline.revision,
				target,
				operation: request.operation,
				strategy: CONTROL_STRATEGY_EXTENSION,
				coverage: desired.boost === 1 ? CONTROL_COVERAGE_TARGET : 'full',
				fields: {},
				...(currentMuted === null ? {} : {
					audioVolume: {
						effectiveVolume: currentEffective,
						volumeState: resolveAcknowledgedAudioVolumeState(
							baseline.fields,
							currentEffective,
							currentMuted,
						),
					},
				}),
				result: { effectiveVolume: currentEffective, ...current },
			};
		}

		const nativeReadbackPatch: ControlPatch = {};
		if (readback?.ok) {
			for (const field of ['volumeBase', 'mediaMuted'] as const) {
				const actual = readback.data.patch[field];
				if (actual !== undefined) Object.assign(nativeReadbackPatch, { [field]: actual });
			}
		}
		const observedFields: ControlFieldStates = readback?.ok
			? mergeMediaObservedFields({}, nativeObservationFields(
				{ patch: nativeReadbackPatch, observedStrategies: readback.data.observedStrategies },
				baseline.revision + 1,
			), readback.data.mediaObservation, true)
			: {};
		let fields: ControlFieldStates = { ...observedFields };
		let mediaObservation = readback?.ok ? readback.data.mediaObservation : undefined;
		let processorStageStarted = false;
		try {
			let staged = baseline;
			let physicalVolumeBase = current.volumeBase;
			let physicalBoost = current.boost;
			const runStage = async (
				stage: 'target' | 'processor',
				patch: ControlPatch,
				assertion: 'apply' | 'release' | 'probe',
				required: ControlPatch = patch,
			): Promise<PreparedControlIntent> => {
				if (stage === 'processor') processorStageStarted = true;
				const prepared = await prepareIntent({
					...common,
					target,
					requestedCoverage: stage === 'target' ? CONTROL_COVERAGE_TARGET : 'full',
					patch,
				}, staged);
				fields = { ...fields, ...prepared.fields };
				if (prepared.mediaObservation && (!mediaObservation
					|| compareMediaObservations(prepared.mediaObservation, mediaObservation) === 1)) mediaObservation = prepared.mediaObservation;
				if (assertion === 'apply') {
					assertAppliedPatch(
						prepared.fields,
						required,
						stage === 'target'
							? 'Effective volume native stage'
							: 'Effective volume processor stage',
					);
				} else if (assertion === 'release') {
					assertReleasedPatch(prepared.fields, patch, 'Effective volume processor release');
				}
				target = prepared.ackTarget ?? target;
				staged = stageSnapshot(baseline, fields, target);
				return prepared;
			};

			if (desiredEffective > CONTROL_VALUE_LIMITS.volumeBase.max && physicalBoost === 1
				&& !processorOwnsScale) {
				// A page controller can expose its own amplified scale. The verdict is
				// probed ONCE when the content runtime detects media on a page entry
				// (read-only bridge capability discovery) and solidified per hostname,
				// so a volume crossing here is verdict-driven instead of paying a
				// write probe on every boundary crossing. Standard pages never touch
				// the page writer at all; supported pages use it directly. A stale
				// `supported` verdict (the site changed its player) fails the write
				// exactly like the old probe and falls back to the split scale.
				// Once Boost is already non-neutral, this document has crossed the
				// native-probe boundary and a read-back processor owns the scale.
				// Keep later increments on that acknowledged owner: releasing it
				// merely to repeat the rejected probe would interrupt visualizer/DSP and
				// may require a fresh user-activation admission if the owner is Capture.
				const verdictDomain = normalizeHostname(baseline.origin) ?? '';
				// A hostname verdict is only a discovery hint: a player can mount
				// after its initial negative probe. Current exact-target readback or
				// an applied page-native ACK outranks that older shared observation.
				// The amplified write still needs its own matching actual ACK below.
				const currentPageWriter = observedFields.volumeBase?.strategy === 'page-native'
					|| (target !== null && sameMediaTarget(target, baseline.activeMedia)
						&& baseline.fields.volumeBase?.phase === 'applied'
						&& baseline.fields.volumeBase.strategy === 'page-native');
				let scaleSupported = currentPageWriter ? true : verdictDomain
					? await settingsRepository.getPageNativeScale(verdictDomain)
					: null;
				if (scaleSupported === null && verdictDomain) {
					const probeResponse = await sendSpectraTabRequest(
						request.tabId,
						'spectra.control.page.scale.probe',
						{},
						{ documentId: baseline.documentId, generation: baseline.generation },
					).catch(() => null);
					scaleSupported = probeResponse?.ok === true
						? probeResponse.data.supported
						: null;
					if (scaleSupported !== null) {
						await settingsRepository.recordPageNativeScale(verdictDomain, scaleSupported);
					}
				}
				let pageNativeApplied = false;
				if (scaleSupported !== false) {
					const nativePrepared = readback?.ok && physicalVolumeBase === desiredEffective
						? null
						: await runStage('target', releaseMute
							? { volumeBase: desiredEffective, mediaMuted: false }
							: { volumeBase: desiredEffective }, 'probe');
					const nativeState = nativePrepared?.fields.volumeBase;
					pageNativeApplied = nativePrepared === null
						? physicalVolumeBase === desiredEffective
						: nativeState?.phase === 'applied'
							&& nativeState.strategy === 'page-native'
							&& nativeState.actual === desiredEffective;
					if (!pageNativeApplied && nativePrepared !== null && scaleSupported === true && verdictDomain) {
						// The solidified verdict is stale; drop it so the next page
						// entry probes the changed player again.
						await settingsRepository.clearPageNativeScale(verdictDomain).catch(() => undefined);
					}
				}
				if (pageNativeApplied) {
					physicalVolumeBase = desiredEffective;
					desired = { volumeBase: desiredEffective, boost: 1 };
					if (knownBoost === null && physicalBoost === 1) {
						// The Content read proved a neutral Boost and the exact page writer
						// acknowledged the full scalar. Record that released observation
						// directly; invoking the processor owner here would wake Offscreen
						// merely to confirm that no Capture graph is needed.
						fields.boost = neutralBoostObservation(baseline.revision + 1, operationId);
					}
				} else {
					if (observedFields.volumeBase) fields.volumeBase = observedFields.volumeBase;
					else Reflect.deleteProperty(fields, 'volumeBase');
					staged = stageSnapshot(baseline, fields, target);
					desired = splitEffectiveVolume(desiredEffective);
					if (!readback?.ok || physicalVolumeBase !== desired.volumeBase || releaseMute) {
						await runStage('target', releaseMute
							? { volumeBase: desired.volumeBase, mediaMuted: false }
							: { volumeBase: desired.volumeBase }, 'apply', { volumeBase: desired.volumeBase });
						physicalVolumeBase = desired.volumeBase;
					}
					if (physicalBoost !== desired.boost || knownBoost === null) {
						await runStage('processor', { boost: desired.boost }, 'apply');
						physicalBoost = desired.boost;
					}
				}
			} else {
				for (const stage of stageOrder) {
					const patch = stage === 'target' ? targetPatch : processorPatch;
					if (Object.keys(patch).length === 0) continue;
					// Neutral boost removes volume demand. The policy owner releases
					// Capture unless independent non-neutral DSP still needs it.
					const isProcessorRelease = stage === 'processor' && desired.boost === 1;
					await runStage(
						stage,
						patch,
						isProcessorRelease ? 'release' : 'apply',
						stage === 'target' ? volumeStagePatch : patch,
					);
				}
			}
			const actualVolumeBase = typeof fields.volumeBase?.actual === 'number'
				? fields.volumeBase.actual
				: current.volumeBase;
			const actualBoost = typeof fields.boost?.actual === 'number'
				? fields.boost.actual
				: current.boost;
			const committed = await commitControlFields(
				baseline,
				fields,
				target,
				{
					mediaObservation,
					acknowledgementTarget: target,
					...presentation,
					// Effective volume is one public value backed by two actual
					// fields. Persist the complete read-back pair even when one
					// component was already correct and needed no writer stage.
					acknowledgedSessionPatch: {
						volumeBase: actualVolumeBase,
						boost: actualBoost,
					},
					sessionScope: controlSessionScopeForSource(request.source),
				},
			);
			const committedVolumeBase = typeof committed.fields.volumeBase?.actual === 'number' ? committed.fields.volumeBase.actual : actualVolumeBase;
			const committedBoost = typeof committed.fields.boost?.actual === 'number' ? committed.fields.boost.actual : actualBoost;
			const committedEffectiveVolume = compileEffectiveVolume(committedVolumeBase, committedBoost);
			// A released mute is part of what this gesture changed. Reporting the
			// pre-write mute here would acknowledge "silent" for a tab that just
			// became audible, and every surface painting from that answer would
			// disagree with the viewer's ears.
			const committedMuted = typeof committed.fields.mediaMuted?.actual === 'boolean'
				? committed.fields.mediaMuted.actual
				: currentMuted;
			const audioVolume = committedMuted === null ? null : {
				effectiveVolume: committedEffectiveVolume,
				volumeState: resolveAcknowledgedAudioVolumeState(
					committed.fields,
					committedEffectiveVolume,
					committedMuted,
				),
			};
			return {
				operationId,
				tabId: request.tabId,
				documentId: committed.documentId,
				generation: committed.generation,
				revision: committed.revision,
				target,
				operation: request.operation,
				strategy: CONTROL_STRATEGY_EXTENSION,
				coverage: committedBoost === 1 ? CONTROL_COVERAGE_TARGET : 'full',
				fields: Object.fromEntries(Object.keys(fields).map((field) => [field, committed.fields[field as ControlField]])) as ControlFieldStates,
				...(committed.mediaObservation ? { mediaObservation: committed.mediaObservation } : {}),
				...(audioVolume ? { audioVolume } : {}),
				result: { effectiveVolume: committedEffectiveVolume, volumeBase: committedVolumeBase, boost: committedBoost },
			};
		} catch (error) {
			if (error instanceof NativeControlExecutionError && error.code === 'stale-media-source'
				&& !processorStageStarted
				&& current.boost === 1 && desired.boost === 1
				&& desiredEffective <= CONTROL_VALUE_LIMITS.volumeBase.max) {
				const attempts = (volumeRecovery?.attempts ?? 0) + 1;
				const deadline = volumeRecovery?.deadline ?? performance.now() + NATIVE_VOLUME_SOURCE_RECOVERY_BUDGET_MS;
				if (request.target !== null || attempts > MAX_NATIVE_VOLUME_SOURCE_RECOVERIES || performance.now() >= deadline) throw error;
				// No processor stage/admission has run. Retire this native attempt
				// without writing its baseline back into the old source. Continue
				// inside the same bounded queue slot, with the original absolute goal:
				// a delta must not be recalculated from the replacement's defaults.
				return executeFieldOperation({ ...request,
					payload: { operation: 'set', value: desiredEffective },
				}, operationId, { baseline: volumeRecovery?.baseline ?? baseline, target, error, attempts, deadline }, onVolumePlan);
			}
			const compensation = await compensateControlPatch(
				baseline,
				target,
				targetPatch.volumeBase === undefined ? {} : { volumeBase: current.volumeBase },
				processorPatch.boost === undefined ? {} : { boost: current.boost },
				[...stageOrder].reverse(),
			);
			if (!compensation.ok) {
				await commitCompensationFailure(
					baseline,
					target,
					{ volumeBase: current.volumeBase, boost: current.boost },
					compensation,
					error,
				);
			}
			throw error;
		}
	}
		if (request.operation === 'seek-relative') {
			const fieldAck = await executeIntent({
				...common,
				requestedCoverage: CONTROL_COVERAGE_TARGET,
			mutations: [{ field: 'currentTime', operation: 'delta', value: request.payload.delta }],
			});
			assertAppliedFields(fieldAck.fields, ['currentTime'], 'Relative seek');
			const currentTime = fieldAck.fields.currentTime?.actual;
			if (typeof currentTime !== 'number') throw new Error('Relative seek did not return actual state');
			return createFieldOperationAck(operationId, request.operation, fieldAck, 'currentTime', { currentTime });
		}
	if (request.operation === 'audio-reset') {
		const baseline = await getOrCreateSnapshot(request.tabId);
		const targetResetPatch = baseline.live ? { volumeBase: 100, mediaMuted: false } : RESET_AUDIO_TARGET_PATCH;
		let target = request.target ?? baseline.activeMedia;
		if (!target) {
			// Snapshot state may legitimately be empty before the first Popup action.
			// Resolve one standard field only to discover the actual active media; a
			// page without media is non-fatal because the processor still must release.
			const observed = await sendSpectraTabRequest(
				request.tabId,
				PROTO_ACTUAL_READ,
				{ fields: ['volumeBase'], target: null },
				{ documentId: baseline.documentId, generation: baseline.generation },
			).catch(() => null);
			if (observed?.ok) target = observed.data.target;
		}
		const targetCapture = await captureActualPatch(
			baseline,
			target,
			[
				...Object.keys(targetResetPatch) as ControlDirectField[],
				'preservePitch',
			],
		);
		const targetActual = targetCapture.patch;
		const outputOwned = targetCapture.observation.observedStrategies.volumeBase === 'capture';
		const nativeResetPatch: ControlPatch = outputOwned ? { speed: 1 } : targetResetPatch;
		const targetRollback: ControlPatch = {};
		for (const field of Object.keys(targetResetPatch) as ControlDirectField[]) {
			const value = targetActual[field];
			if (value !== undefined) (targetRollback as Record<string, unknown>)[field] = value;
		}
		const processorRollback = (await captureActualPatch(
			baseline,
			target,
			Object.keys(RESET_AUDIO_PROCESSOR_PATCH) as ControlDirectField[],
		)).patch;
		let staged = baseline;
		let fields: ControlFieldStates = {};
		try {
			const targetPrepared = await prepareIntent({
				...common,
				target,
				requestedCoverage: CONTROL_COVERAGE_TARGET,
				patch: nativeResetPatch,
			}, staged);
			const targetUnavailable = target === null
				&& (Object.keys(nativeResetPatch) as ControlDirectField[]).every((field) => {
					const failure = targetPrepared.fields[field]?.lastError;
					return Boolean(failure
						&& (failure.code === 'capability-unavailable' || failure.code === 'strategy-runtime-failed')
						&& failure.message.includes('No active media target'));
				});
			if (!targetUnavailable) {
				assertAppliedPatch(targetPrepared.fields, nativeResetPatch, 'Audio target reset');
				target = targetPrepared.ackTarget ?? targetPrepared.activeMedia ?? target;
				fields = { ...fields, ...targetPrepared.fields };
				// Reset explicitly normalizes playback speed. Pitch preservation is
				// observation-only and is carried into the processor's native context.
				staged = stageSnapshot(baseline, {
					...nativeObservationFields(targetCapture.observation, baseline.revision),
					...fields,
				}, targetPrepared.activeMedia ?? target);
			}
			const processorPrepared = await prepareIntent({
				...common,
				target,
				requestedCoverage: 'full',
				patch: outputOwned ? { ...RESET_AUDIO_PROCESSOR_PATCH, volumeBase: 100, mediaMuted: false } : RESET_AUDIO_PROCESSOR_PATCH,
				releaseDocumentOutput: true,
			}, staged);
			fields = { ...fields, ...processorPrepared.fields };
			assertReleasedPatch(
				processorPrepared.fields,
				RESET_AUDIO_PROCESSOR_PATCH,
				'Audio processor reset',
			);
			const committed = await commitControlFields(
				baseline,
				fields,
				target,
				{ sessionScope: controlSessionScopeForSource(request.source) },
			);
			const audioVolume = resolveControlAudioVolume(committed.fields);
			return {
				operationId,
				tabId: request.tabId,
				documentId: committed.documentId,
				generation: committed.generation,
				revision: committed.revision,
				target,
				operation: request.operation,
				strategy: CONTROL_STRATEGY_EXTENSION,
				coverage: 'full',
				fields,
				...(audioVolume ? { audioVolume } : {}),
				result: { reset: true },
			};
		} catch (error) {
			const compensation = await compensateControlPatch(
				baseline,
				target,
				targetRollback,
				processorRollback,
			);
			if (!compensation.ok) {
				await commitCompensationFailure(
					baseline,
					target,
					{ ...targetRollback, ...processorRollback },
					compensation,
					error,
				);
			}
			throw error;
		}
	}
		if (request.operation === 'video-effects-toggle') {
			const fieldAck = await executeIntent({
				...common,
				requestedCoverage: CONTROL_COVERAGE_TARGET,
				mutations: [{ field: 'filterEnabled', operation: 'toggle' }],
			});
			assertAppliedFields(fieldAck.fields, ['filterEnabled'], 'Video effects toggle');
			const enabled = fieldAck.fields.filterEnabled?.actual;
			if (typeof enabled !== 'boolean') throw new Error('Video effects toggle did not return actual state');
			return createFieldOperationAck(operationId, request.operation, fieldAck, 'filterEnabled', { enabled });
		}
	if (request.operation === 'video-effects-reset') {
		const fieldAck = await executeIntent({
			...common,
			requestedCoverage: CONTROL_COVERAGE_TARGET,
			patch: RESET_VIDEO_PATCH,
			});
			assertAppliedPatch(fieldAck.fields, RESET_VIDEO_PATCH, 'Video effects reset');
			return createFieldOperationAck(
				operationId,
				request.operation,
				fieldAck,
				'filterEnabled',
				{ reset: true },
				CONTROL_STRATEGY_EXTENSION,
				CONTROL_COVERAGE_TARGET,
			);
		}
	throw new Error(`Operation ${request.operation} is not a field operation`);
}

async function executeControlOperation(
	request: RoutedControlOperationRequest,
	operationId = crypto.randomUUID(),
	contextSnapshot?: ControlSnapshot,
	onVolumePlan?: ControlVolumePlanObserver,
): Promise<ControlOperationAck> {
	const snapshot = contextSnapshot ?? await getOrCreateSnapshot(request.tabId);
	if (request.baseRevision !== undefined && request.baseRevision !== snapshot.revision) {
		throw new StaleControlRevisionError(snapshot.revision);
	}
	if (request.target && request.target.documentId !== snapshot.documentId) {
		throw new Error('The selected media target belongs to a stale document');
	}
	if (request.operation === 'effective-volume'
		|| request.operation === 'seek-relative'
		|| request.operation === 'audio-reset'
		|| request.operation === 'video-effects-toggle'
		|| request.operation === 'video-effects-reset') {
		return executeFieldOperation(request, operationId, undefined, onVolumePlan);
	}
	if (request.operation === 'open-popup') {
		const tab = await currentOperationTab(request.tabId, snapshot.documentId);
		await chrome.action.openPopup({ windowId: tab.windowId });
		return commitBackgroundOperation(request, operationId, CONTROL_STRATEGY_CHROME_NATIVE, { opened: true }, snapshot);
	}
	if (request.operation === 'open-options') {
		await chrome.runtime.openOptionsPage();
		return commitBackgroundOperation(request, operationId, CONTROL_STRATEGY_CHROME_NATIVE, { opened: true }, snapshot);
	}
	if (request.operation === 'open-url') {
		const tab = await currentOperationTab(request.tabId, snapshot.documentId);
		await chrome.tabs.create({
			url: normalizeHttpUrl(request.payload.url),
			windowId: tab.windowId,
			index: tab.index + 1,
			openerTabId: request.tabId,
			active: true,
		});
		return commitBackgroundOperation(request, operationId, CONTROL_STRATEGY_CHROME_NATIVE, { opened: true }, snapshot);
	}
	if (request.operation === 'run-user-script') {
		const result = await executeUserScriptInTab(
			request.tabId,
			snapshot.documentId,
			request.payload.script,
		);
		if (!result.success) throw new Error(result.error ?? 'User script execution failed');
		return commitBackgroundOperation(request, operationId, CONTROL_STRATEGY_EXTENSION, { executed: true }, snapshot);
	}
	if (request.operation === 'restore-page-settings') {
		const baseline = await getOrCreateSnapshot(request.tabId);
		const target = request.target ?? baseline.activeMedia;
		const targetRollback = (await captureActualPatch(
			baseline,
			target,
			RESTORABLE_TARGET_FIELDS,
			true,
		)).patch;
		const processorRollback = (await captureActualPatch(
			baseline,
			target,
			RESTORABLE_PROCESSOR_FIELDS,
		)).patch;
		let fields: ControlFieldStates = {};
		try {
			const contentRequest = {
				...request,
				payload: {},
			} as RoutedControlOperationRequest;
			const preparedRelease = await prepareContentOperation(contentRequest, operationId, baseline);
			const released = preparedRelease.acknowledgement as ControlOperationAck<'restore-page-settings'>;
			fields = { ...fields, ...released.fields };
			const staged = stageSnapshot(baseline, fields, released.target);
			const processorPrepared = await prepareIntent({
				tabId: request.tabId,
				source: request.source,
				requestedCoverage: 'full',
				target: released.target,
				patch: RESET_AUDIO_PROCESSOR_PATCH,
				releaseDocumentOutput: true,
				...(request.captureAdmission
					? { captureAdmission: request.captureAdmission }
					: {}),
			}, staged);
			fields = { ...fields, ...processorPrepared.fields };
			assertReleasedPatch(
				processorPrepared.fields,
				RESET_AUDIO_PROCESSOR_PATCH,
				'Page processor release',
			);
			const committed = await commitControlFields(
				baseline,
				fields,
				released.target,
				{ sessionScope: controlSessionScopeForSource(request.source), acknowledgementTarget: released.target,
					mediaObservation: processorPrepared.mediaObservation ?? released.mediaObservation },
			);
			releaseMediaIntentRuntimeLease(committed.tabId, committed.documentId);
			return {
				...released,
				revision: committed.revision,
				fields: Object.fromEntries(Object.keys(fields).map((field) => [field, committed.fields[field as ControlField]])) as ControlFieldStates,
				...(committed.mediaObservation ? { mediaObservation: committed.mediaObservation } : {}),
				result: {
					releasedFields: [
						...new Set([
							...released.result.releasedFields,
							...Object.keys(processorPrepared.fields) as ControlField[],
						]),
					],
				},
			} as ControlOperationAck<'restore-page-settings'>;
		} catch (error) {
			const compensation = await compensateControlPatch(
				baseline,
				target,
				targetRollback,
				processorRollback,
			);
			if (!compensation.ok) {
				await commitCompensationFailure(
					baseline,
					target,
					{ ...targetRollback, ...processorRollback },
					compensation,
					error,
				);
			}
			throw error;
		}
	}
	return routeContentOperation(request, operationId);
}

async function captureAdmissionForInvocation(
	tabId: number,
	invocation: ExtensionInvocationContext,
	snapshot: ControlSnapshot,
	operationId: string,
): Promise<CaptureAdmission | undefined> {
	// A validated page shortcut may use a grant from an earlier extension
	// invocation in this document. The browser checks that grant at acquisition;
	// the request's origin alone cannot prove it absent.
	// Eligibility is frozen at physical invocation time. An alternate target
	// cannot gain Capture merely because focus moves while its writer is queued.
	if (!sameExtensionDocument(invocation.foreground, invocation.target)) return undefined;
	const tabs = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
	if (tabs[0]?.id !== tabId) return undefined;
	await assertInvocationTargetCurrent(tabId, invocation);
	if (snapshot.documentId !== invocation.target.documentId) {
		throw new Error('Capture admission target does not match the current control document');
	}
	return mintCaptureAdmission({
		kind: 'capture-start',
		operationId,
		document: {
			tabId,
			frameId: 0,
			documentId: snapshot.documentId,
		},
		documentEpoch: snapshot.generation,
		issuer: 'control-authority',
	});
}

async function recordSuccessfulExtensionUse(
	tabId: number,
	source: ControlIntent['source'],
): Promise<void> {
	if (source === 'page' || source === 'restore' || source === 'system') return;
	await markBadgeUsedForTab(tabId);
	await reprojectBadgeForCurrentDocument(tabId);
}

// Presentation follows a successful physical/durable control acknowledgement.
// Reuse the existing per-tab projection tail so sticky usage and the final
// badge remain ordered with tab-session projection without delaying the caller.
function scheduleSuccessfulExtensionUse(
	tabId: number,
	source: ControlIntent['source'],
): void {
	if (source === 'page' || source === 'restore' || source === 'system') return;
	scheduleSessionProjection(tabId, () => recordSuccessfulExtensionUse(tabId, source));
}

function submitSerialized(
	request: RoutedControlSubmitRequest,
	invocation?: ExtensionInvocationContext,
): Promise<ControlApplyAck> {
	if (request.source === 'page' && request.mediaObservation) return submitOrderedPageObservation(request);
	const initialize = request.source === 'restore'
		|| request.source === 'page' && request.target !== null
		? Promise.resolve()
		: awaitDocumentInitialization(
			request.tabId,
			invocation?.target.documentId ?? request.observationDocumentId,
		);
	return initialize.then(() => serialized(request.tabId, async () => {
		if (invocation) await assertInvocationTargetCurrent(request.tabId, invocation);
		const unadmittedRequest = { ...request };
		Reflect.deleteProperty(unadmittedRequest, 'captureAdmission');
		const snapshot = await getOrCreateSnapshot(request.tabId);
		const intentId = crypto.randomUUID();
		const captureAdmission = invocation
			? await captureAdmissionForInvocation(request.tabId, invocation, snapshot, intentId)
			: undefined;
		try {
			const baseRequest = {
				...unadmittedRequest,
				...(captureAdmission ? { captureAdmission } : {}),
			};
			// A page observation is an idempotent fact about the current page
			// state: it carries no ordering semantics and never re-writes the
			// DOM, unlike a user intent. When a sibling commit advanced the
			// snapshot revision between this transaction's read and its commit,
			// the observation was silently dropped and the card kept painting a
			// stale value until another event happened to publish the truth.
			// Re-running once against a fresh snapshot recovers it without
			// weakening the revision guarantee that protects user intents.
			const acknowledgement = request.source === 'page'
				? await executeIntent(baseRequest, snapshot, intentId).catch(
					() => executeIntent(baseRequest, undefined, intentId),
				)
				: await executeIntent(baseRequest, snapshot, intentId);
			if (!isControlApplyAck(acknowledgement)) {
				throw new Error('Control executor returned a strategy outside the capability policy');
			}
			scheduleSuccessfulExtensionUse(request.tabId, request.source);
			return acknowledgement;
		} finally {
			revokeCaptureAdmission(captureAdmission);
		}
	}));
}

async function submitOrderedPageObservation(request: RoutedControlSubmitRequest): Promise<ControlApplyAck> {
	const baseline = await getOrCreateSnapshot(request.tabId);
	const expectedEpoch = navigationEpoch(request.tabId);
	if (request.target && request.target.documentId !== baseline.documentId
		|| request.target === null && request.observationDocumentId !== baseline.documentId) {
		throw new Error('Physical page observation belongs to a stale document');
	}
	const intent = createIntent(baseline, { ...request, patch: request.patch ?? {} }, crypto.randomUUID());
	const fields = applyPageObservation(intent, request.observedStrategies);
	const sameSelection = request.mediaObservation && baseline.mediaObservation
		&& sameMediaObservationSelection(request.mediaObservation, baseline.mediaObservation)
		&& sameMediaTarget(request.target, baseline.activeMedia);
	// A newer sample of another field can advance the selection's maxclock
	// while this partial sample is in flight. Field clocks decide those values;
	// only another selection/owner or a retired source rejects the whole batch.
	if (!mediaSampleCanReplace(baseline, request.mediaObservation) && !sameSelection
		|| isRetiredMediaSample(request.tabId, request.target, request.mediaObservation)) {
		return { intentId: intent.intentId, tabId: baseline.tabId, documentId: baseline.documentId,
			generation: baseline.generation, revision: baseline.revision, target: baseline.activeMedia, fields: {},
			...(baseline.mediaObservation ? { mediaObservation: baseline.mediaObservation } : {}) };
	}
	// Processor normalization remains an effectful control transaction. Pure
	// native observations (especially playing) never wait behind that actor.
	if (typeof request.patch?.volumeBase === 'number' && volumeObservationCanNormalize(baseline, request.mediaObservation)) {
		const known = baseline.fields.boost?.actual;
		const session = typeof known === 'number' ? null : await getAudioSession(baseline.tabId).catch(() => null);
		const boost = typeof known === 'number' ? known : session?.documentId === baseline.documentId
			&& session.generation === baseline.generation ? resolveAudioVolume(session.actualConfig).boost : 1;
		if (boost !== 1) return serialized(request.tabId, () => executeIntent(request));
	}
	const current = await admitPhysicalObservation(baseline, { target: request.target, patch: request.patch ?? {},
		observedStrategies: request.observedStrategies ?? {}, mediaObservation: request.mediaObservation,
		...(typeof request.live === 'boolean' ? { live: request.live } : {}) }, 'media', expectedEpoch, true);
	return { intentId: intent.intentId, tabId: current.tabId, documentId: current.documentId,
		generation: current.generation, revision: current.revision, target: current.activeMedia,
		fields: Object.fromEntries(Object.keys(fields).map((field) => [field, current.fields[field as ControlField]])) as ControlFieldStates,
		...(current.mediaObservation ? { mediaObservation: current.mediaObservation } : {}) };
}

function submitOperationSerialized(
	request: RoutedControlOperationRequest,
	invocation?: ExtensionInvocationContext,
	onVolumePlan?: ControlVolumePlanObserver,
): Promise<ControlOperationAck> {
	const initialize = request.source === 'restore'
		? Promise.resolve()
		: awaitDocumentInitialization(request.tabId, invocation?.target.documentId);
	return initialize.then(() => serialized(request.tabId, async () => {
		if (invocation) await assertInvocationTargetCurrent(request.tabId, invocation);
		const unadmittedRequest = { ...request };
		Reflect.deleteProperty(unadmittedRequest, 'captureAdmission');
		const snapshot = await getOrCreateSnapshot(request.tabId);
		const operationId = crypto.randomUUID();
		const captureAdmission = invocation
			? await captureAdmissionForInvocation(request.tabId, invocation, snapshot, operationId)
			: undefined;
		try {
			const acknowledgement = await executeControlOperation({
				...unadmittedRequest,
				...(captureAdmission ? { captureAdmission } : {}),
			}, operationId, snapshot, onVolumePlan);
			if (!isControlOperationAck(acknowledgement)) {
				throw new Error('Control operation returned a strategy outside the capability policy');
			}
			scheduleSuccessfulExtensionUse(request.tabId, request.source);
			return acknowledgement;
		} finally {
			revokeCaptureAdmission(captureAdmission);
		}
	}));
}

export function submitControlRequest(request: RoutedControlSubmitRequest): Promise<ControlApplyAck> {
	return submitSerialized(request);
}

export function submitControlOperation(
	request: RoutedControlOperationRequest,
): Promise<ControlOperationAck> {
	return submitOperationSerialized(request);
}

export function submitExtensionInvokedControlRequest(
	request: RoutedControlSubmitRequest & { source: 'popup' | 'hotkey' },
	invocation: ExtensionInvocationContext,
): Promise<ControlApplyAck> {
	return submitSerialized(request, invocation);
}

export function submitExtensionInvokedControlOperation(
	request: RoutedControlOperationRequest & { source: 'popup' | 'hotkey' },
	invocation: ExtensionInvocationContext,
	onVolumePlan?: ControlVolumePlanObserver,
): Promise<ControlOperationAck> {
	return submitOperationSerialized(request, invocation, onVolumePlan);
}

export function isExtensionPopupSender(sender: chrome.runtime.MessageSender): boolean {
	return isActionPopupSender(sender);
}

function trustedContentHotkeyInvocation(
	sender: chrome.runtime.MessageSender,
	tabId: number,
): ExtensionInvocationContext | undefined {
	if (!(sender.id === chrome.runtime.id
		&& sender.tab?.id === tabId
		&& sender.frameId === 0
		&& typeof sender.documentId === 'string'
		&& typeof sender.url === 'string'
		&& /^https?:/u.test(sender.url))) return undefined;
	const document = { tabId, documentId: sender.documentId };
	return {
		origin: 'site-page',
		foreground: document,
		target: document,
	};
}

export async function resolvePopupControlPresentationIdentity(
	tabId: number,
	documentId: string,
): Promise<Pick<ControlSnapshot, 'tabId' | 'documentId' | 'origin' | 'generation'>> {
	const expectedEpoch = navigationEpoch(tabId);
	const invocation = await popupInvocation(tabId);
	assertPopupRequestDocument(invocation, documentId);
	// Opening the action Popup invoked the extension for this document. Record
	// that document-lifetime fact before any control is submitted: the hotkey
	// gate must keep Alt+Up on the content path after the Popup closes.
	grantContentInvocation(invocation.target.tabId, invocation.target.documentId);
	const snapshot = await getOrCreateSnapshot(tabId);
	assertNavigationFence(tabId, expectedEpoch, snapshot);
	if (snapshot.documentId !== documentId) throw new Error('Popup presentation belongs to a stale document');
	return { tabId, documentId, origin: snapshot.origin, generation: snapshot.generation };
}

export async function flushControlPresentation(tabId: number): Promise<void> {
	await sessionProjectionTails.get(tabId)?.catch(() => undefined);
}

export async function submitPopupControlBatch(
	batch: PopupControlBatch,
): Promise<PopupControlBatchResult> {
	let volumeAck: ControlOperationAck<'effective-volume'> | null = null;
	const fieldAcks: ControlApplyAck[] = [];
	let batchError: RpcError | null = null;
	const recordFailure = (error: unknown): void => {
		batchError ??= {
			code: 'popup_control_failed',
			message: error instanceof Error ? error.message : String(error),
			retryable: true,
		} satisfies RpcError;
	};
	let invocation: ExtensionInvocationContext;
	try {
		invocation = await popupInvocation(batch.tabId);
		assertPopupRequestDocument(invocation, batch.documentId);
	} catch (error) {
		recordFailure(error);
		return { volumeAck, fieldAcks, error: batchError };
	}
	if (batch.effectiveVolume !== null) {
		try {
			volumeAck = await submitOperationSerialized({
				tabId: batch.tabId,
				source: 'popup',
				target: null,
				operation: 'effective-volume',
				payload: { operation: 'set', value: batch.effectiveVolume },
			}, invocation) as ControlOperationAck<'effective-volume'>;
			batchError ??= Object.values(volumeAck.fields)
				.find((field) => field?.phase === 'error' && field.lastError)?.lastError ?? null;
		} catch (error) {
			recordFailure(error);
		}
	}
	for (const group of batch.groups) {
		try {
			fieldAcks.push(await submitSerialized({
				tabId: batch.tabId,
				source: 'popup',
				target: null,
				requestedCoverage: group.requestedCoverage,
				patch: group.patch,
			}, invocation));
		} catch (error) {
			recordFailure(error);
		}
	}
	await flushControlPresentation(batch.tabId);
	const audioSession = await getAudioSession(batch.tabId).catch(() => null);
	return {
		volumeAck, fieldAcks, error: batchError,
		...(audioSession?.documentId === batch.documentId ? { audioSession } : {}),
	};
}

const popupVisualizerSource = createPopupVisualizerSource({
	runExclusive: serialized,
	getOrCreateSnapshot,
});

export const acquirePopupVisualizerSource = popupVisualizerSource.acquire;
export const releasePopupVisualizerSource = popupVisualizerSource.release;
export const abandonPopupVisualizerSource = popupVisualizerSource.abandon;

async function removeTab(tabId: number): Promise<void> {
	const expectedEpoch = fenceNavigation(tabId);
	try {
		await serialized(tabId, async () => {
			snapshots.delete(tabId);
			await chrome.storage.local.remove([
				storageKey(tabId),
				generationKey(tabId),
			]).catch(() => undefined);
		});
	} finally {
		forgetCaptureAdmissionsForTab(tabId);
		if (navigationEpoch(tabId) === expectedEpoch) navigationFences.delete(tabId);
		stalePersistedSnapshots.delete(tabId);
		for (const key of retiredMediaSources.keys()) if (key.startsWith(`${tabId}:`)) retiredMediaSources.delete(key);
	}
}

function queueNavigationInvalidation(
	tabId: number,
	preserveDocumentState: boolean,
	expectedEpoch: number,
): Promise<void> {
	const fence = navigationFences.get(tabId);
	if (!fence || fence.epoch !== expectedEpoch) {
		return Promise.reject(new Error('Control navigation fence was superseded'));
	}
	if (fence.settlement) return fence.settlement;
	const operation = serialized(tabId, async () => {
		assertNavigationFence(tabId, expectedEpoch);
		const [memory, persisted, storedGeneration] = await Promise.all([
			Promise.resolve(snapshots.get(tabId) ?? null),
			stalePersistedSnapshots.has(tabId)
				? Promise.resolve(null)
				: readPersistedSnapshot(tabId),
			readPersistedGeneration(tabId),
		]);
		assertNavigationFence(tabId, expectedEpoch);
		const previousGeneration = Math.max(
			storedGeneration,
			memory?.generation ?? 0,
			persisted?.generation ?? 0,
		);
		const generation = Math.max(
			navigationFences.get(tabId)?.generationFloor ?? 0,
			previousGeneration + 1,
		);
		const currentFence = navigationFences.get(tabId);
		if (currentFence && generation > currentFence.generationFloor) currentFence.generationFloor = generation;
		const previousSnapshot = memory ?? persisted;
		if (preserveDocumentState && previousSnapshot) {
			const revision = previousSnapshot.revision + 1;
			const carried: ControlSnapshot = {
				...previousSnapshot,
				generation,
				revision,
				fields: Object.fromEntries(Object.entries(previousSnapshot.fields).map(([field, state]) => [
					field,
					state ? { ...state, revision } : state,
				])) as ControlFieldStates,
			};
			// The presentation kind is a measured fact about one element in one
			// document. A new generation has not measured anything yet, so carrying
			// it would let the previous document's stream disable speed here.
			delete carried.live;
			await persistGeneration(tabId, generation);
			await publishSnapshot(carried, expectedEpoch);
			await reconcileRuntimeOwnership(carried);
			assertNavigationFence(tabId, expectedEpoch, carried);
			return;
		}
		snapshots.delete(tabId);
		await Promise.all([
			persistGeneration(tabId, generation),
			chrome.storage.local.remove([
				storageKey(tabId),
			]),
		]);
		stalePersistedSnapshots.delete(tabId);
	});
	fence.pending = true;
	fence.settled = false;
	fence.settlement = operation;
	const settlement = operation.then(
		async () => {
			if (navigationFences.get(tabId) !== fence) return;
			fence.pending = false;
			fence.settled = true;
			fence.settlement = undefined;
			if (!preserveDocumentState) return;
			const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 }).catch(() => null);
			const current = snapshots.get(tabId);
			if (!frame?.documentId || !current || current.documentId !== frame.documentId
				|| navigationFences.get(tabId) !== fence || fence.pending) return;
			const event = createSpectraEvent('spectra.navigation.changed', { url: frame.url }, {
				tabId, documentId: current.documentId, generation: current.generation,
			});
			void chrome.tabs.sendMessage(tabId, event, { documentId: current.documentId }).catch(() => undefined);
		},
		(error: unknown) => {
			if (navigationFences.get(tabId) !== fence) return;
			fence.pending = false;
			fence.settled = false;
			fence.settlement = undefined;
			throw error;
		},
	);
	fence.settlement = settlement;
	return settlement;
}

function invalidateNavigation(
	tabId: number,
	preserveDocumentState = false,
	reuseBeforeNavigation = false,
): Promise<void> {
	const existing = navigationFences.get(tabId);
	if (reuseBeforeNavigation && existing?.beforeNavigate) {
		existing.beforeNavigate = false;
		if (existing.settled) return Promise.resolve();
		return queueNavigationInvalidation(tabId, preserveDocumentState, existing.epoch);
	}
	const expectedEpoch = fenceNavigation(tabId, preserveDocumentState);
	return queueNavigationInvalidation(tabId, preserveDocumentState, expectedEpoch);
}

/** Synchronously fences old work, then starts the durable full-navigation transition. */
export function beginDocumentNavigation(tabId: number): Promise<void> {
	const expectedEpoch = fenceNavigation(tabId, false, true);
	return queueNavigationInvalidation(tabId, false, expectedEpoch);
}

export function initializeControlCoordinator(): void {
	if (initialized) return;
	initialized = true;
	chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
		if (!message || typeof message !== 'object') return false;
		const candidate = message as { protocolVersion?: unknown; type?: unknown };
		const isControlMessage = candidate.type === PROTO_SNAPSHOT_GET
			|| candidate.type === PROTO_INTENT_SUBMIT
			|| candidate.type === PROTO_OPERATION_SUBMIT
			|| candidate.type === PROTO_SOURCE_RELEASED
			|| candidate.type === PROTO_TARGET_CHANGED;
		if (candidate.protocolVersion !== SPECTRA_PROTOCOL_VERSION || !isControlMessage) return false;
		if (sender.id !== chrome.runtime.id) {
			sendResponse(rpcFailure('forbidden', 'Control coordinator RPC is extension-internal only'));
			return false;
		}
		if (!isBackgroundRequestEnvelope(message)
			|| (message.type !== PROTO_SNAPSHOT_GET
				&& message.type !== PROTO_INTENT_SUBMIT
				&& message.type !== PROTO_OPERATION_SUBMIT
				&& message.type !== PROTO_SOURCE_RELEASED
				&& message.type !== PROTO_TARGET_CHANGED)) {
			sendResponse(rpcFailure(RPC_INVALID_REQUEST, 'Malformed control coordinator request'));
			return false;
		}

		if (message.type === 'spectra.content.source.released') {
			const tabId = sender.tab?.id;
			if (!tabId || sender.documentId !== message.payload.target.documentId) {
				sendResponse(rpcFailure('forbidden', 'Source lifecycle must match its sending document'));
				return false;
			}
			void handleSourceReleased(tabId, message.payload.target, message.payload.mediaObservation).then(
				() => sendResponse(rpcSuccess({ accepted: true as const })),
				(error) => sendResponse(rpcFailure(
					'source_release_failed',
					error instanceof Error ? error.message : String(error),
					true,
				)),
			);
			return true;
		}

		if (message.type === 'spectra.content.target.changed') {
			const tabId = sender.tab?.id;
			if (!tabId || sender.documentId !== message.payload.target.documentId) {
				sendResponse(rpcFailure('forbidden', 'Active media selection must match its sending document'));
				return false;
			}
			void handleTargetChanged(tabId, message.payload.target, message.payload.mediaObservation).then(
				() => sendResponse(rpcSuccess({ accepted: true as const })),
				(error) => sendResponse(rpcFailure(
					'target_change_failed',
					error instanceof Error ? error.message : String(error),
					true,
				)),
			);
			return true;
		}

		if (message.type === PROTO_SNAPSHOT_GET) {
			void getControlViewSnapshot(message.payload.tabId).then(
				(snapshot) => sendResponse(rpcSuccess(snapshot)),
				(error) => sendResponse(rpcFailure('snapshot_unavailable', String(error), true)),
			);
			return true;
		}

		const tabId = message.payload.tabId ?? sender.tab?.id ?? message.tabId;
		if (!tabId) {
			sendResponse(rpcFailure(RPC_INVALID_REQUEST, 'Control intent requires a target tab'));
			return false;
		}
		const siteHotkeyInvocation = message.payload.source === 'hotkey'
			? trustedContentHotkeyInvocation(sender, tabId)
			: undefined;
		const rejection = authorizeRuntimeControl({
			sender,
			tabId,
			source: message.payload.source,
			target: message.payload.target,
			popupSender: message.payload.source === 'popup' && isExtensionPopupSender(sender),
			hotkeySender: siteHotkeyInvocation !== undefined,
		});
		if (rejection) {
			sendResponse(rpcFailure(rejection.code, rejection.message));
			return false;
		}
		const pageObservation = message.type === PROTO_INTENT_SUBMIT && message.payload.source === 'page';
		const operation = (async () => {
			const invocation = message.payload.source === 'popup'
				? await popupInvocation(tabId)
				: siteHotkeyInvocation;
			if (message.payload.source === 'popup' && invocation) {
				assertPopupRequestDocument(invocation, message.documentId);
			}
			return message.type === PROTO_OPERATION_SUBMIT
				? submitOperationSerialized(
					{ ...message.payload, tabId } as RoutedControlOperationRequest,
					invocation,
				)
				: submitSerialized({
					...message.payload,
					tabId,
					...(pageObservation && message.payload.target === null
						? { observationDocumentId: sender.documentId }
						: {}),
				}, invocation);
		})();
		void operation.then(
			(ack) => sendResponse(rpcSuccess(ack)),
			(error) => sendResponse(rpcFailure(
				error instanceof StaleControlRevisionError
					? 'control_stale_revision'
					: error instanceof NativeControlExecutionError
						? error.code
					: message.type === PROTO_OPERATION_SUBMIT
						? 'control_operation_failed'
						: 'control_apply_failed',
				error instanceof Error ? error.message : String(error),
				true,
			)),
		);
		return true;
	});

	chrome.tabs.onRemoved.addListener((tabId) => { void removeTab(tabId); });
	chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
		const patch: Pick<ControlPatch, 'tabMuted' | 'tabPinned'> = {};
		if (typeof changeInfo.pinned === 'boolean') patch.tabPinned = changeInfo.pinned;
		if (typeof changeInfo.mutedInfo?.muted === 'boolean') {
			patch.tabMuted = changeInfo.mutedInfo.muted;
		}
		if (Object.keys(patch).length > 0) {
			void observeChromeTabState(tabId, patch).catch((error: unknown) => {
				/* @__PURE__ */ swLog.debug(`[Control] Ignored tab-state observation without a controllable document: ${String(error)}`);
			});
		}
		if (changeInfo.status === 'complete') {
			void awaitDocumentInitialization(tabId)
				.then(() => serialized(tabId, () => reprojectBadgeForCurrentDocument(tabId)))
				.catch((error: unknown) => {
					/* @__PURE__ */ swLog.debug(`[Control] Badge navigation projection settled at browser boundary: ${String(error)}`);
				});
		}
	});
	chrome.webNavigation.onCommitted.addListener((details) => {
		if (details.frameId === 0) {
			void invalidateNavigation(details.tabId, false, true).catch((error: unknown) => {
				/* @__PURE__ */ swLog.debug(`[Control] Navigation invalidation settled at browser boundary: ${String(error)}`);
			});
			const fence = navigationFences.get(details.tabId);
			if (fence && details.documentId) fence.route = { documentId: details.documentId, url: details.url };
		}
	});
	const onSameDocumentNavigation = (details: { tabId: number; frameId: number; documentId: string; url: string }): void => {
		if (details.frameId !== 0) return;
		const previous = navigationFences.get(details.tabId)?.route;
		if (previous?.documentId === details.documentId && previous.url === details.url) return;
		void invalidateNavigation(details.tabId, true).catch((error: unknown) => {
			/* @__PURE__ */ swLog.debug(`[Control] Route projection settled at browser boundary: ${String(error)}`);
		});
		const fence = navigationFences.get(details.tabId);
		if (fence) fence.route = { documentId: details.documentId, url: details.url };
	};
	chrome.webNavigation.onHistoryStateUpdated.addListener(onSameDocumentNavigation);
	chrome.webNavigation.onReferenceFragmentUpdated.addListener(onSameDocumentNavigation);
}

// Direct test surface for module-scoped MV3 state. These exports are not used
// by the background entry and are removed from production bundles.
export const controlCoordinatorTestApi = {
	submit: submitSerialized,
	submitInvoked: (
		request: RoutedControlSubmitRequest,
		invocation: ExtensionInvocationContext,
	) => submitSerialized(request, invocation),
	submitOperation: submitOperationSerialized,
	submitOperationInvoked: (
		request: RoutedControlOperationRequest,
		invocation: ExtensionInvocationContext,
	) => (
		submitOperationSerialized(request, invocation)
	),
	isExtensionPopupSender,
	trustedContentHotkeyInvocation,
	popupInvocation,
	getSnapshot,
	getViewSnapshot: getControlViewSnapshot,
	beginDocumentNavigation,
	targetChanged: handleTargetChanged,
	sourceReleased: handleSourceReleased,
	observeChromeTabState,
	invalidateNavigation,
	reprojectBadgeForCurrentDocument,
	scheduleSuccessfulExtensionUse,
	assertPopupRequestDocument,
	flushSessionProjections,
	async reset(): Promise<void> {
		await serialized.drain();
		await snapshotPublications.drain();
		// Drain the repository's trailing debounce while the test/background
		// Chrome storage owner still exists. Otherwise a late timer can outlive
		// the service-worker harness and write through a deleted global.
		await storage.tabSession.flush().catch(() => undefined);
		// Drain deferred session projections so tests observe a fully-settled
		// store (tab_session projections run off the ACK path but still write
		// the same storage rows).
		await flushSessionProjections();
		snapshots.clear();
		retiredMediaSources.clear();
		navigationFences.clear();
		stalePersistedSnapshots.clear();
		initialized = false;
	},
};
