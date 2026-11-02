// goal: authoritative per-field intent ordering, actual ACK commit, and snapshot projection

import {
	audioSessionMatchesControlDocument,
	clampControlValue,
	compileEffectiveVolume,
	CONTROL_VALUE_LIMITS,
	createBoundedMap,
	createSpectraEvent,
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
	type CaptureAdmission,
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
	projectControlSessionPatch,
	projectControlTarget,
	RESET_AUDIO_PROCESSOR_PATCH,
	RESET_AUDIO_TARGET_PATCH,
	RESET_VIDEO_PATCH,
	RESTORABLE_PROCESSOR_FIELDS,
	RESTORABLE_TARGET_FIELDS,
	sameMediaTarget,
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
// Navigation is fenced synchronously before its durable transition enters the
// per-tab queue. A queued invalidation alone is insufficient: a control
// transaction may be awaiting Content/storage while Chrome has already moved
// the tab to another document. The epoch lets every in-flight transaction
// reject before it can publish its old generation.
interface NavigationFence {
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
	const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
	if (!frame?.documentId) throw new Error('The tab has no current document');
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
	const base: ControlSnapshot = existing ?? {
		tabId,
		documentId: identity.documentId,
		origin: identity.origin,
		generation,
		revision: 0,
		activeMedia: null,
		activeVideo: null,
		fields: {},
	};
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
		requestedCoverage: request.requestedCoverage,
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

async function publishSnapshot(
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

async function persistControlProjection(
	snapshot: ControlSnapshot,
	changedFields: ControlFieldStates,
	acknowledgedSessionPatch: ControlSessionPatch = {},
	scope: TabControlSessionScope | 'none' = 'none',
	expectedEpoch = navigationEpoch(snapshot.tabId),
): Promise<void> {
	if (scope === 'none') return;
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
	const currentResourcePatch = {
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
	const session = await getAudioSession(snapshot.tabId).catch(() => null);
	assertNavigationFence(snapshot.tabId, expectedEpoch, snapshot);
	const isCaptureActive = audioSessionMatchesControlDocument(session, snapshot)
		&& isActiveCaptureLifecycle(session);
	await updateBadgeFromControlProjection(
		snapshot,
		completeSession,
		isCaptureActive,
		false,
	);
	assertNavigationFence(snapshot.tabId, expectedEpoch, snapshot);
}

// Chrome clears a tab-scoped Action projection during full navigation. Rebuild
// it only after the document initialization barrier has restored the current
// acknowledged session; the badge remains a projection, never another owner.
async function reprojectBadgeForCurrentDocument(tabId: number): Promise<void> {
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
	const session = await getAudioSession(tabId).catch(() => null);
	const isCaptureActive = audioSessionMatchesControlDocument(session, snapshot)
		&& isActiveCaptureLifecycle(session);
	await updateBadgeFromControlProjection(
		snapshot,
		completeSession,
		isCaptureActive,
		false,
	);
}

interface PreparedControlIntent {
	audioVolume?: ControlApplyAck['audioVolume'];
	intent: ControlIntent;
	baseline: ControlSnapshot;
	ackTarget: MediaTarget | null;
	activeMedia: ControlSnapshot['activeMedia'];
	activeVideo: ControlSnapshot['activeVideo'];
	fields: ControlFieldStates;
}

interface CommitControlProjection {
	activeVideo?: ControlSnapshot['activeVideo'];
	acknowledgedSessionPatch?: ControlSessionPatch;
	sessionScope?: TabControlSessionScope | 'none';
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

	const resolvedRequest = await resolveSubmitRequest(snapshot, request);
	const intent = createIntent(snapshot, resolvedRequest, intentId ?? crypto.randomUUID());
	const pageObservation = intent.source === 'page';
	const chromeResult = pageObservation
		? { remaining: {}, fields: applyPageObservation(intent, resolvedRequest.observedStrategies) }
		: await applyChromeFields(intent);
	let fields: ControlFieldStates = { ...chromeResult.fields };
	let ackTarget = intent.target;
	let audioVolume: ControlApplyAck['audioVolume'];
	let activeMedia = snapshot.activeMedia;
	let activeVideo = snapshot.activeVideo;
	if (pageObservation) {
		({ activeMedia, activeVideo } = projectControlTarget(
			snapshot,
			Object.keys(intent.patch) as ControlCapability[],
			intent.target,
		));
	}
	if (pageObservation && typeof intent.patch.volumeBase === 'number') {
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
		if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
		if (!controlApplyAckMatches(response.data, intent)) {
			throw new Error('Content runtime returned a stale control ACK');
		}
		ackTarget = response.data.target;
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
	return { intent, baseline, ackTarget, activeMedia, activeVideo, fields, ...(audioVolume ? { audioVolume } : {}) };
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
	const committed: ControlSnapshot = {
		...current,
		revision,
		activeMedia,
		activeVideo,
		fields: { ...current.fields, ...fields },
	};
	await publishSnapshot(committed, expectedEpoch);
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

async function executeIntent(
	request: RoutedControlSubmitRequest,
	contextSnapshot?: ControlSnapshot,
	intentId?: string,
): Promise<ControlApplyAck> {
	const current = contextSnapshot ?? await getOrCreateSnapshot(request.tabId);
	const prepared = await prepareIntent(request, current, intentId);
	const { intent, baseline, ackTarget, activeMedia, activeVideo, fields } = prepared;
	const committed = await commitControlFields(
		baseline,
		fields,
		activeMedia,
		{
			activeVideo,
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
		fields,
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
	const stages = {
		target: [isolatedTargetPatch, CONTROL_COVERAGE_TARGET],
		processor: [processorPatch, 'full'],
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
			sessionScope: controlSessionScopeForSource(source),
		},
	);
	if (committed.revision !== intent.baseRevision + 1) {
		throw new Error('Control operation committed an unexpected revision');
	}
	return { ...acknowledgement, revision: committed.revision } as ControlOperationAck;
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

async function handleSourceReleased(tabId: number, target: import('@nexus/contracts').MediaTarget): Promise<void> {
	releaseSourceRuntimeLease(tabId, target, 'marker');
	releaseSourceRuntimeLease(tabId, target, 'ab');
	const snapshot = await getSnapshot(tabId);
	if (!snapshot || snapshot.documentId !== target.documentId) return;
	const ownsActiveSource = snapshot.activeMedia?.mediaId === target.mediaId
		&& snapshot.activeMedia.sourceRevision === target.sourceRevision;
	const ownsActiveVideo = snapshot.activeVideo?.mediaId === target.mediaId
		&& snapshot.activeVideo.sourceRevision === target.sourceRevision;
	const ab = snapshot.fields.abLoop;
	if (!ownsActiveSource && !ownsActiveVideo
		&& (!ab || ab.phase === 'idle' || !ab.controlled)) return;
	const intentId = crypto.randomUUID();
	const fields: ControlFieldStates = ab && (ownsActiveSource || snapshot.activeMedia === null)
		? {
			abLoop: {
				desired: null,
				actual: { pointA: null, pointB: null, enabled: false },
				revision: snapshot.revision + 1,
				phase: 'idle',
				strategy: CONTROL_STRATEGY_EXTENSION,
				coverage: CONTROL_COVERAGE_TARGET,
				controlled: false,
				intentId,
				lastError: null,
			},
		}
		: {};
	await commitControlFields(
		snapshot,
		fields,
		ownsActiveSource ? null : snapshot.activeMedia,
		{
			activeVideo: ownsActiveVideo ? null : snapshot.activeVideo,
			sessionScope: 'resource',
		},
	);
}

async function handleTargetChanged(
	tabId: number,
	target: import('@nexus/contracts').MediaTarget,
): Promise<void> {
	const baseline = await getOrCreateSnapshot(tabId);
	if (target.frameId !== 0 || target.documentId !== baseline.documentId) {
		throw new Error('Active media selection belongs to a stale or unsupported frame');
	}
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
		'playback-toggle' | 'seek-relative' | 'video-effects-toggle' | 'video-effects-reset'
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
		result,
	} as ControlOperationAck<O>;
}

async function executeFieldOperation(
	request: RoutedControlOperationRequest,
	operationId: string,
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
		const snapshotActual = (field: 'volumeBase' | 'boost'): number | null => {
			const actual = baseline.fields[field]?.actual;
			return typeof actual === 'number' ? actual : null;
		};
		const knownVolumeBase = snapshotActual('volumeBase');
		const knownBoost = snapshotActual('boost');
		const knownMuted = baseline.fields.mediaMuted?.actual;
		const missingActualFields = [
			...(knownVolumeBase === null ? ['volumeBase' as const] : []),
			...(knownBoost === null ? ['boost' as const] : []),
			...(typeof knownMuted === 'boolean' ? [] : ['mediaMuted' as const]),
		];
		// ControlSnapshot is the actual-value owner. Only a cold snapshot needs one
		// Content readback for its unknown fields; established fields never regress
		// to an unrelated getter sample merely because mute still needs observation.
		const readback = missingActualFields.length > 0
			? await sendSpectraTabRequest(
				request.tabId,
				PROTO_ACTUAL_READ,
				{ fields: missingActualFields, target: request.target },
				{ documentId: baseline.documentId, generation: baseline.generation },
			).catch(() => null)
			: null;
		const actualField = <K extends 'volumeBase' | 'boost'>(field: K): number | null => {
			const direct = readback?.ok ? readback.data.patch[field] : undefined;
			if (typeof direct === 'number') return direct;
			const known = field === 'volumeBase' ? knownVolumeBase : knownBoost;
			return known;
		};
		const currentVolumeBase = actualField('volumeBase') ?? CONTROL_VALUE_LIMITS.volumeBase.max;
		const current = {
			volumeBase: currentVolumeBase,
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
		const currentMuted = typeof observedMuted === 'boolean'
			? observedMuted
			: typeof knownMuted === 'boolean'
				? knownMuted
				: null;
		const currentEffective = compileEffectiveVolume(current.volumeBase, current.boost);
		const desiredEffective = clampControlValue(
			request.payload.operation === 'delta'
				? currentEffective + request.payload.value
				: request.payload.value,
			'volume',
			currentEffective,
		);
		let desired = desiredEffective > CONTROL_VALUE_LIMITS.volumeBase.max
			&& current.boost === 1
			&& current.volumeBase > CONTROL_VALUE_LIMITS.volumeBase.max
			? { volumeBase: desiredEffective, boost: 1 }
			: splitEffectiveVolume(desiredEffective);
		let target = readback?.ok ? readback.data.target : request.target ?? baseline.activeMedia;
		const targetPatch: ControlPatch = current.volumeBase === desired.volumeBase
			? {}
			: { volumeBase: desired.volumeBase };
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

		// A repeated slider sample at the already acknowledged value is a true
		// no-op: no content IPC, no storage write and no synthetic revision.
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
			? nativeObservationFields(
				{ patch: nativeReadbackPatch, observedStrategies: readback.data.observedStrategies },
				baseline.revision + 1,
			)
			: {};
		let fields: ControlFieldStates = { ...observedFields };
		try {
			let staged = baseline;
			let physicalVolumeBase = current.volumeBase;
			let physicalBoost = current.boost;
			const runStage = async (
				stage: 'target' | 'processor',
				patch: ControlPatch,
				assertion: 'apply' | 'release' | 'probe',
			): Promise<PreparedControlIntent> => {
				const prepared = await prepareIntent({
					...common,
					target,
					requestedCoverage: stage === 'target' ? CONTROL_COVERAGE_TARGET : 'full',
					patch,
				}, staged);
				fields = { ...fields, ...prepared.fields };
				if (assertion === 'apply') {
					assertAppliedPatch(
						prepared.fields,
						patch,
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
					const nativePrepared = physicalVolumeBase === desiredEffective
						? null
						: await runStage('target', { volumeBase: desiredEffective }, 'probe');
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
					if (physicalVolumeBase !== desired.volumeBase) {
						await runStage('target', { volumeBase: desired.volumeBase }, 'apply');
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
					);
				}
			}
			const actualVolumeBase = typeof fields.volumeBase?.actual === 'number'
				? fields.volumeBase.actual
				: current.volumeBase;
			const actualBoost = typeof fields.boost?.actual === 'number'
				? fields.boost.actual
				: current.boost;
			const effectiveVolume = compileEffectiveVolume(actualVolumeBase, actualBoost);
			const committed = await commitControlFields(
				baseline,
				fields,
				target,
				{
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
			const audioVolume = currentMuted === null ? null : {
				effectiveVolume,
				volumeState: resolveAcknowledgedAudioVolumeState(
					committed.fields,
					effectiveVolume,
					currentMuted,
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
				coverage: actualBoost === 1 ? CONTROL_COVERAGE_TARGET : 'full',
				fields,
				...(audioVolume ? { audioVolume } : {}),
				result: { effectiveVolume, volumeBase: actualVolumeBase, boost: actualBoost },
			};
		} catch (error) {
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
		if (request.operation === 'playback-toggle') {
			const fieldAck = await executeIntent({
				...common,
				requestedCoverage: CONTROL_COVERAGE_TARGET,
				mutations: [{ field: 'playing', operation: 'toggle' }],
			});
			assertAppliedFields(fieldAck.fields, ['playing'], 'Playback toggle');
			const playing = fieldAck.fields.playing?.actual;
			if (typeof playing !== 'boolean') throw new Error('Playback toggle did not return actual state');
			return createFieldOperationAck(operationId, request.operation, fieldAck, 'playing', { playing });
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
				...Object.keys(RESET_AUDIO_TARGET_PATCH) as ControlDirectField[],
				'preservePitch',
			],
		);
		const targetActual = targetCapture.patch;
		const targetRollback: ControlPatch = {};
		for (const field of Object.keys(RESET_AUDIO_TARGET_PATCH) as ControlDirectField[]) {
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
				patch: RESET_AUDIO_TARGET_PATCH,
			}, staged);
			const targetUnavailable = target === null
				&& (Object.keys(RESET_AUDIO_TARGET_PATCH) as ControlDirectField[]).every((field) => {
					const failure = targetPrepared.fields[field]?.lastError;
					return Boolean(failure
						&& (failure.code === 'capability-unavailable' || failure.code === 'strategy-runtime-failed')
						&& failure.message.includes('No active media target'));
				});
			if (!targetUnavailable) {
				assertAppliedPatch(targetPrepared.fields, RESET_AUDIO_TARGET_PATCH, 'Audio target reset');
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
				patch: RESET_AUDIO_PROCESSOR_PATCH,
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
): Promise<ControlOperationAck> {
	const snapshot = contextSnapshot ?? await getOrCreateSnapshot(request.tabId);
	if (request.baseRevision !== undefined && request.baseRevision !== snapshot.revision) {
		throw new StaleControlRevisionError(snapshot.revision);
	}
	if (request.target && request.target.documentId !== snapshot.documentId) {
		throw new Error('The selected media target belongs to a stale document');
	}
	if (request.operation === 'playback-toggle'
		|| request.operation === 'effective-volume'
		|| request.operation === 'seek-relative'
		|| request.operation === 'audio-reset'
		|| request.operation === 'video-effects-toggle'
		|| request.operation === 'video-effects-reset') {
		return executeFieldOperation(request, operationId);
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
				{ sessionScope: controlSessionScopeForSource(request.source) },
			);
			releaseMediaIntentRuntimeLease(committed.tabId, committed.documentId);
			return {
				...released,
				revision: committed.revision,
				fields,
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

function submitOperationSerialized(
	request: RoutedControlOperationRequest,
	invocation?: ExtensionInvocationContext,
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
			}, operationId, snapshot);
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
): Promise<ControlOperationAck> {
	return submitOperationSerialized(request, invocation);
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
	return { volumeAck, fieldAcks, error: batchError };
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
	void operation.then(
		() => {
			if (navigationFences.get(tabId) !== fence) return;
			fence.pending = false;
			fence.settled = true;
			fence.settlement = undefined;
		},
		() => {
			if (navigationFences.get(tabId) !== fence) return;
			fence.pending = false;
			fence.settled = false;
			fence.settlement = undefined;
		},
	);
	return operation;
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
			void serialized(tabId, () => handleSourceReleased(tabId, message.payload.target)).then(
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
			void serialized(tabId, () => handleTargetChanged(tabId, message.payload.target)).then(
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
			void awaitDocumentInitialization(message.payload.tabId)
				.then(() => getControlViewSnapshot(message.payload.tabId)).then(
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
		}
	});
	chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
		if (details.frameId === 0) {
			void invalidateNavigation(details.tabId, true).catch((error: unknown) => {
				/* @__PURE__ */ swLog.debug(`[Control] History projection settled at browser boundary: ${String(error)}`);
			});
		}
	});
	chrome.webNavigation.onReferenceFragmentUpdated.addListener((details) => {
		if (details.frameId === 0) {
			void invalidateNavigation(details.tabId, true).catch((error: unknown) => {
				/* @__PURE__ */ swLog.debug(`[Control] Fragment projection settled at browser boundary: ${String(error)}`);
			});
		}
	});
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
		// Drain the repository's trailing debounce while the test/background
		// Chrome storage owner still exists. Otherwise a late timer can outlive
		// the service-worker harness and write through a deleted global.
		await storage.tabSession.flush().catch(() => undefined);
		// Drain deferred session projections so tests observe a fully-settled
		// store (tab_session projections run off the ACK path but still write
		// the same storage rows).
		await flushSessionProjections();
		snapshots.clear();
		navigationFences.clear();
		stalePersistedSnapshots.clear();
		initialized = false;
	},
};
