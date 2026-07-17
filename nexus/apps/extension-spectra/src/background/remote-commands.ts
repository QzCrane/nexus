// Executes the fixed, validated remote command set against one bound tab.

import type {
	ControlApplyAck,
	ControlMutation,
	ControlOperationAck,
	ControlOperationRequest,
	ControlSnapshot,
	ControlSubmitRequest,
} from '@nexus/contracts';
import {
	REMOTE_COMMAND_DESCRIPTORS,
	isSpectraEventEnvelope,
	resolveAudioVolume,
} from '@nexus/contracts';
import { isRemoteCommand, type RemoteState } from '../remote/protocol';
import {
	getControlViewSnapshot,
	submitControlOperation,
	submitControlRequest,
} from './control-coordinator';

type StateCallback = (tabId: number, state: RemoteState) => void;

let stateCallback: StateCallback | null = null;
let snapshotListenerInstalled = false;

interface StableRemoteProjection {
	documentId: string;
	generation: number;
	revision: number;
	state: RemoteState;
}

const stableRemoteStates = new Map<number, StableRemoteProjection>();

type RoutedControlSubmitRequest = Omit<ControlSubmitRequest, 'tabId'> & { tabId: number };
type RoutedControlOperationRequest = ControlOperationRequest & { tabId: number };

export interface RemoteControlGateway {
	submit(request: RoutedControlSubmitRequest): Promise<ControlApplyAck>;
	submitOperation(request: RoutedControlOperationRequest): Promise<ControlOperationAck>;
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
	if (!callback) stableRemoteStates.clear();
	// Tests and MV3 teardown may clear the callback after the Chrome global has
	// already gone away. Installing the listener is only meaningful while a
	// remote consumer is active.
	if (!callback || snapshotListenerInstalled || typeof chrome === 'undefined') return;
	snapshotListenerInstalled = true;
	chrome.runtime.onMessage.addListener((message: unknown) => {
		if (!isSpectraEventEnvelope(message)
			|| message.type !== 'spectra.control.snapshot.changed') return false;
		void publishRemoteState(message.payload);
		return false;
	});
	chrome.tabs.onRemoved?.addListener((tabId) => stableRemoteStates.delete(tabId));
}

export async function executeCommand(
	command: unknown,
	tabId: number,
	gateway: RemoteControlGateway = coordinatorGateway,
): Promise<boolean> {
	if (!isRemoteCommand(command) || !Number.isInteger(tabId) || tabId <= 0) return false;

	const descriptor = REMOTE_COMMAND_DESCRIPTORS[command];
	if (descriptor.capability === 'playback-toggle'
		|| descriptor.capability === 'seek-relative') {
		await gateway.submitOperation({
				tabId,
				source: 'remote',
				target: null,
				operation: descriptor.capability,
				payload: descriptor.capability === 'seek-relative'
					? { delta: descriptor.value ?? 0 }
					: {},
			} as RoutedControlOperationRequest);
		return true;
	}
	const field = descriptor.capability;
	if (!['volumeBase', 'boost', 'mediaMuted', 'playing', 'currentTime', 'speed', 'fullscreen', 'pip'].includes(field)) {
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
		});
	const failure = Object.values(ack.fields)
		.find((fieldState) => fieldState?.phase !== 'applied');
	if (failure) throw new Error(failure.lastError?.message ?? 'Remote control was not applied');
	return true;
}

export async function syncState(
	tabId: number,
	gateway: RemoteControlGateway = coordinatorGateway,
): Promise<void> {
	if (!stateCallback || !Number.isInteger(tabId) || tabId <= 0) return;
	try {
		const snapshot = await gateway.getSnapshot(tabId);
		if (snapshot) await publishRemoteState(snapshot);
	} catch {
		// The tab may have navigated or closed between authentication and sync.
	}
}

async function publishRemoteState(snapshot: ControlSnapshot): Promise<void> {
	if (!stateCallback) return;
	const previous = stableRemoteStates.get(snapshot.tabId);
	if (previous && (
		previous.generation > snapshot.generation
		|| (previous.generation === snapshot.generation
			&& previous.documentId === snapshot.documentId
			&& previous.revision > snapshot.revision)
	)) return;
	const tab = await chrome.tabs.get(snapshot.tabId).catch(() => undefined);
	let tabDomain = '';
	if (tab?.url) {
		try {
			const parsed = new URL(tab.url);
			if (parsed.protocol === 'http:' || parsed.protocol === 'https:') tabDomain = parsed.hostname;
		} catch {
			// Non-web tabs intentionally expose no domain.
		}
	}
	const sameDocument = previous?.documentId === snapshot.documentId
		&& previous.generation === snapshot.generation;
	const baseline = sameDocument ? previous.state : {
		generation: snapshot.generation,
		volume: 100,
		volumeBase: 100,
		boost: 1,
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
	const volume = resolveAudioVolume({ volume: volumeBase * boost, volumeBase, boost });
	const state: RemoteState = {
		generation: snapshot.generation,
		volume: volume.effectiveVolume,
		volumeBase: volume.volumeBase,
		boost: volume.boost,
		muted: actual('mediaMuted', baseline.muted),
		playing: actual('playing', baseline.playing),
		speed: actual('speed', baseline.speed),
		tabTitle: tab ? (tab.title ?? '').slice(0, 512) : baseline.tabTitle ?? '',
		tabDomain: tab ? tabDomain : baseline.tabDomain ?? '',
	};
	stableRemoteStates.set(snapshot.tabId, {
		documentId: snapshot.documentId,
		generation: snapshot.generation,
		revision: snapshot.revision,
		state,
	});
	stateCallback(snapshot.tabId, state);
}
