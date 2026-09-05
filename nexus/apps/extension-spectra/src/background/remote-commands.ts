// Executes the fixed, validated remote command set against one bound tab.

import type {
	ControlApplyAck,
	ControlMutation,
	ControlOperationAck,
	ControlOperationRequest,
	ControlSnapshot,
	ControlSubmitRequest,
	AudioSessionSnapshot,
} from '@nexus/contracts';
import {
	REMOTE_COMMAND_DESCRIPTORS,
	audioSessionMatchesControlDocument,
	resolveAudioVolume,
	resolveAudioVolumeState,
} from '@nexus/contracts';
import { isRemoteCommand, type RemoteState } from '../remote/protocol';
import {
	getControlViewSnapshot,
	submitControlOperation,
	submitControlRequest,
} from './control-coordinator';
import { getAudioSession } from './audio-session-store';
import { isBackgroundEventEnvelope } from './background-rpc';

type StateCallback = (tabId: number, state: RemoteState) => void | Promise<void>;

let stateCallback: StateCallback | null = null;
let snapshotListenerInstalled = false;

interface StableRemoteProjection {
	documentId: string;
	origin: string;
	generation: number;
	revision: number;
	snapshot: ControlSnapshot;
	state: RemoteState;
}

const stableRemoteStates = new Map<number, StableRemoteProjection>();
const remotePublicationTokens = new Map<number, object>();

interface RemotePublicationRequest {
	snapshot: ControlSnapshot;
	knownSession?: AudioSessionSnapshot | null;
	publicationToken: object;
	resolve: () => void;
	reject: (error: unknown) => void;
}

interface RemotePublicationQueue {
	running: boolean;
	current: RemotePublicationRequest | null;
	pending: RemotePublicationRequest | null;
}

const remotePublicationQueues = new Map<number, RemotePublicationQueue>();

function remotePublicationToken(tabId: number): object {
	const current = remotePublicationTokens.get(tabId);
	if (current) return current;
	const created = {};
	remotePublicationTokens.set(tabId, created);
	return created;
}

export function invalidateRemoteTab(tabId: number): void {
	stableRemoteStates.delete(tabId);
	const queue = remotePublicationQueues.get(tabId);
	queue?.pending?.resolve();
	if (queue) queue.pending = null;
	remotePublicationQueues.delete(tabId);
	// Deleting the exact token invalidates publishers captured before removal.
	// A reused Chrome tab id receives a fresh token without retaining tombstones.
	remotePublicationTokens.delete(tabId);
}

type RoutedControlSubmitRequest = Omit<ControlSubmitRequest, 'tabId'> & { tabId: number };
type RoutedControlOperationRequest = ControlOperationRequest & { tabId: number };

export interface RemoteControlGateway {
	submit(request: RoutedControlSubmitRequest, signal?: AbortSignal): Promise<ControlApplyAck>;
	submitOperation(request: RoutedControlOperationRequest, signal?: AbortSignal): Promise<ControlOperationAck>;
	getSnapshot(tabId: number): Promise<ControlSnapshot | null>;
}

const coordinatorGateway: RemoteControlGateway = {
	submit: submitControlRequest,
	submitOperation: submitControlOperation,
	getSnapshot: getControlViewSnapshot,
};

export type { RemoteCommand, RemoteState } from '../remote/protocol';

export function setStateCallback(callback: StateCallback | null): void {
	stateCallback = callback;
	if (!callback) {
		stableRemoteStates.clear();
		remotePublicationQueues.clear();
		remotePublicationTokens.clear();
	}
	// Tests and MV3 teardown may clear the callback after the Chrome global has
	// already gone away. Installing the listener is only meaningful while a
	// remote consumer is active.
	if (!callback || snapshotListenerInstalled || typeof chrome === 'undefined') return;
	snapshotListenerInstalled = true;
	chrome.runtime.onMessage.addListener((message: unknown) => {
		if (!isBackgroundEventEnvelope(message)) return false;
		if (message.type === 'spectra.control.snapshot.changed') {
			void publishRemoteState(message.payload).catch(() => undefined);
		} else if (message.type === 'spectra.audio.session.changed') {
			const stable = stableRemoteStates.get(message.payload.tabId);
			if (stable?.documentId === message.payload.documentId
				&& stable.origin === message.payload.origin
				&& stable.generation === message.payload.generation) {
				void publishRemoteState(stable.snapshot, message.payload).catch(() => undefined);
			}
		}
		return false;
	});
	chrome.tabs.onRemoved?.addListener(invalidateRemoteTab);
}

export async function executeCommand(
	command: unknown,
	tabId: number,
	gateway: RemoteControlGateway = coordinatorGateway,
	signal?: AbortSignal,
): Promise<boolean> {
	if (!isRemoteCommand(command) || !Number.isInteger(tabId) || tabId <= 0) return false;
	throwIfRemoteCommandAborted(signal);

	const descriptor = REMOTE_COMMAND_DESCRIPTORS[command];
	if (descriptor.capability === 'effective-volume'
		|| descriptor.capability === 'playback-toggle'
		|| descriptor.capability === 'seek-relative') {
		const acknowledgement = await gateway.submitOperation({
				tabId,
				source: 'remote',
				target: null,
				operation: descriptor.capability,
				payload: descriptor.capability === 'effective-volume'
					? { operation: descriptor.operation as 'set' | 'delta', value: descriptor.value ?? 0 }
					: descriptor.capability === 'seek-relative'
						? { delta: descriptor.value ?? 0 }
						: {},
			} as RoutedControlOperationRequest, signal);
		throwIfRemoteCommandAborted(signal);
		const failure = Object.values(acknowledgement.fields)
			.find((fieldState) => fieldState?.phase !== 'applied');
		if (failure) throw new Error(failure.lastError?.message ?? 'Remote control was not applied');
		return true;
	}
	const field = descriptor.capability;
	if (field !== 'volumeBase'
		&& field !== 'boost'
		&& field !== 'mediaMuted'
		&& field !== 'playing'
		&& field !== 'speed') {
		throw new Error(`Remote capability is not executable: ${descriptor.capability}`);
	}
	const mutation: ControlMutation = {
		field: field as ControlMutation['field'],
		operation: descriptor.operation,
		...(descriptor.value === undefined ? {} : { value: descriptor.value }),
	};
	const ack = await gateway.submit({
			tabId,
			source: 'remote',
			requestedCoverage: descriptor.capability === 'boost' ? 'full' : 'active-target',
			target: null,
			mutations: [mutation],
		}, signal);
	throwIfRemoteCommandAborted(signal);
	const failure = Object.values(ack.fields)
		.find((fieldState) => fieldState?.phase !== 'applied');
	if (failure) throw new Error(failure.lastError?.message ?? 'Remote control was not applied');
	return true;
}

function throwIfRemoteCommandAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new Error('REMOTE_COMMAND_CANCELLED');
}

export async function syncState(
	tabId: number,
	gateway: RemoteControlGateway = coordinatorGateway,
): Promise<void> {
	if (!stateCallback || !Number.isInteger(tabId) || tabId <= 0) return;
	const publicationToken = remotePublicationToken(tabId);
	try {
		const [snapshot, session] = await Promise.all([
			gateway.getSnapshot(tabId),
			getAudioSession(tabId).catch(() => null),
		]);
		if (snapshot && remotePublicationTokens.get(tabId) === publicationToken) {
			await publishRemoteState(snapshot, session, publicationToken);
		}
	} catch {
		// The tab may have navigated or closed between authentication and sync.
		if (remotePublicationTokens.get(tabId) === publicationToken) {
			stableRemoteStates.delete(tabId);
		}
	}
}

function isOlderRemoteProjection(
	previous: StableRemoteProjection | undefined,
	snapshot: ControlSnapshot,
): boolean {
	return Boolean(previous && (
		previous.generation > snapshot.generation
		|| (previous.generation === snapshot.generation
			&& previous.documentId === snapshot.documentId
			&& previous.origin === snapshot.origin
			&& previous.revision > snapshot.revision)
	));
}

function isRemoteSnapshotAtOrAfter(
	previous: ControlSnapshot | undefined,
	snapshot: ControlSnapshot,
): boolean {
	return Boolean(previous && (
		previous.generation > snapshot.generation
		|| (previous.generation === snapshot.generation
			&& previous.documentId === snapshot.documentId
			&& previous.origin === snapshot.origin
			&& previous.revision >= snapshot.revision)
	));
}

function publishRemoteState(
	snapshot: ControlSnapshot,
	knownSession?: AudioSessionSnapshot | null,
	publicationToken = remotePublicationToken(snapshot.tabId),
): Promise<void> {
	if (isRemoteSnapshotAtOrAfter(stableRemoteStates.get(snapshot.tabId)?.snapshot, snapshot)) {
		return Promise.resolve();
	}
	let resolveRequest!: () => void;
	let rejectRequest!: (error: unknown) => void;
	const result = new Promise<void>((resolve, reject) => {
		resolveRequest = resolve;
		rejectRequest = reject;
	});
	const request: RemotePublicationRequest = {
		snapshot,
		knownSession,
		publicationToken,
		resolve: resolveRequest,
		reject: rejectRequest,
	};
	const queue = remotePublicationQueues.get(snapshot.tabId) ?? {
		running: false,
		current: null,
		pending: null,
	};
	remotePublicationQueues.set(snapshot.tabId, queue);
	if (!queue.running) {
		queue.running = true;
		queue.current = request;
		void drainRemotePublication(snapshot.tabId, queue);
		return result;
	}
	if (queue.pending && isRemoteSnapshotAtOrAfter(queue.pending.snapshot, snapshot)) {
		// A newer pending snapshot already supersedes this request. Its caller is
		// told that no additional delivery is required rather than growing a
		// waiter list behind the in-flight publication.
		resolveRequest();
		return result;
	}
	if (queue.pending) queue.pending.resolve();
	queue.pending = request;
	return result;
}

async function drainRemotePublication(tabId: number, queue: RemotePublicationQueue): Promise<void> {
	while (queue.current) {
		const request = queue.current;
		queue.current = null;
		try {
			await publishRemoteStateNow(
				request.snapshot,
				request.knownSession,
				request.publicationToken,
			);
			request.resolve();
		} catch (error) {
			request.reject(error);
		}
		if (!queue.pending) break;
		queue.current = queue.pending;
		queue.pending = null;
	}
	queue.running = false;
	if (remotePublicationQueues.get(tabId) === queue) remotePublicationQueues.delete(tabId);
}

async function publishRemoteStateNow(
	snapshot: ControlSnapshot,
	knownSession?: AudioSessionSnapshot | null,
	publicationToken = remotePublicationToken(snapshot.tabId),
): Promise<void> {
	const callback = stateCallback;
	if (!callback || remotePublicationTokens.get(snapshot.tabId) !== publicationToken) return;
	const previous = stableRemoteStates.get(snapshot.tabId);
	if (isOlderRemoteProjection(previous, snapshot)) return;
	const sameDocument = previous?.documentId === snapshot.documentId
		&& previous.origin === snapshot.origin
		&& previous.generation === snapshot.generation;
	const needsTabMetadata = !sameDocument || !previous?.state.tabTitle;
	const tab = needsTabMetadata
		? await chrome.tabs.get(snapshot.tabId).catch(() => undefined)
		: undefined;
	let tabDomain = sameDocument ? previous?.state.tabDomain ?? '' : '';
	if (tab?.url) {
		try {
			const parsed = new URL(tab.url);
			if (parsed.protocol === 'http:' || parsed.protocol === 'https:') tabDomain = parsed.hostname;
		} catch {
			// Non-web tabs intentionally expose no domain.
			tabDomain = '';
		}
	}
	const baseline = sameDocument ? previous.state : {
		generation: snapshot.generation,
		volume: 100,
		volumeBase: 100,
		boost: 1,
		actualMode: 'bypass' as const,
		phase: 'idle' as const,
		muted: false,
		playing: false,
		speed: 1,
		tabTitle: '',
		tabDomain: '',
	};
	const actual = <T>(field: keyof ControlSnapshot['fields'], fallback: T): T => {
		const fieldState = snapshot.fields[field];
		if (fieldState?.phase !== 'applied') return fallback;
		const value = fieldState.actual;
		return value === null || value === undefined ? fallback : value as T;
	};
	const volumeBase = actual('volumeBase', baseline.volumeBase ?? baseline.volume);
	const boost = actual('boost', baseline.boost ?? 1);
	const volume = resolveAudioVolume({ volumeBase, boost });
	const session = knownSession === undefined
		? await getAudioSession(snapshot.tabId).catch(() => null)
		: knownSession;
	// Every potentially suspended read is inside the per-tab publication tail.
	// Recheck callback and projection authority before the external delivery ACK.
	if (stateCallback !== callback
		|| remotePublicationTokens.get(snapshot.tabId) !== publicationToken
		|| isOlderRemoteProjection(stableRemoteStates.get(snapshot.tabId), snapshot)) return;
	const sessionMatches = audioSessionMatchesControlDocument(session, snapshot);
	const actualMode = sessionMatches && session ? session.actualMode : baseline.actualMode;
	const phase = sessionMatches && session ? session.phase : baseline.phase;
	const muted = actual('mediaMuted', baseline.muted);
	const volumeState = resolveAudioVolumeState({
		volume: volume.effectiveVolume,
		muted,
		actualMode,
		phase,
	});
	const state: RemoteState = {
		generation: snapshot.generation,
		revision: snapshot.revision,
		volume: volume.effectiveVolume,
		volumeBase: volume.volumeBase,
		boost: volume.boost,
		actualMode,
		phase,
		volumeState,
		muted,
		playing: actual('playing', baseline.playing),
		speed: actual('speed', baseline.speed),
		tabTitle: tab ? (tab.title ?? '').slice(0, 512) : baseline.tabTitle ?? '',
		tabDomain: tab ? tabDomain : baseline.tabDomain ?? '',
	};
	const projection: StableRemoteProjection = {
		documentId: snapshot.documentId,
		origin: snapshot.origin,
		generation: snapshot.generation,
		revision: snapshot.revision,
		snapshot,
		state,
	};
	await callback(snapshot.tabId, state);
	if (stateCallback !== callback
		|| remotePublicationTokens.get(snapshot.tabId) !== publicationToken
		|| isOlderRemoteProjection(stableRemoteStates.get(snapshot.tabId), snapshot)) return;
	stableRemoteStates.set(snapshot.tabId, projection);
}
