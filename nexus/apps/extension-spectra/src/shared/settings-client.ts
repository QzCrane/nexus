// goal: full revision-aware settings client for Popup and other full-snapshot consumers
// eff: delegates envelope creation and message dispatch to canonical transport

import {
	createSpectraRequest,
	type RpcResult,
	type SettingsPatch,
	type SettingsPatchRequest,
	type SettingsSnapshot,
	type SpectraRequestPayload,
	type SpectraResponse,
} from '@nexus/contracts';
import {
	isSpectraFullSettingsEventEnvelope,
	isSpectraFullSettingsResponse,
} from '@nexus/contracts/full-settings-runtime';
import {
	applyRevisionedPatchWithRetry,
	createRevisionedSettingsClient,
	selectNewestRevisionedSnapshot,
	type RevisionedSettingsTransport,
} from './revisioned-settings-client';
import { sendSpectraRpcMessage } from './transport';

export type SettingsPatchRetryTransport = RevisionedSettingsTransport<SettingsSnapshot, SettingsPatch>;

type FullSettingsRequestType =
	| 'spectra.settings.get'
	| 'spectra.settings.patch'
	| 'spectra.settings.flush';

function sendFullSettingsRequest<T extends FullSettingsRequestType>(
	type: T,
	payload: SpectraRequestPayload<T>,
): Promise<SpectraResponse<T>> {
	const message = createSpectraRequest(type, payload);
	return sendSpectraRpcMessage(message, isSpectraFullSettingsResponse, 'Background');
}

const fullSettingsTransport: SettingsPatchRetryTransport = {
	async getSnapshot(): Promise<SettingsSnapshot> {
		const result = await sendFullSettingsRequest('spectra.settings.get', {});
		if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
		return result.data;
	},
	async sendPatch(request: SettingsPatchRequest): Promise<RpcResult<SettingsSnapshot>> {
		return sendFullSettingsRequest('spectra.settings.patch', request);
	},
};

const fullSettingsClient = createRevisionedSettingsClient<SettingsSnapshot, SettingsPatch>(
	fullSettingsTransport,
);

export const selectNewestSettingsSnapshot = selectNewestRevisionedSnapshot;

export function applySettingsPatchWithRetry(
	patch: SettingsPatch,
	transport: SettingsPatchRetryTransport,
): Promise<SettingsSnapshot> {
	return applyRevisionedPatchWithRetry(patch, transport);
}

export function subscribeSettingsSnapshots(
	listener: (snapshot: SettingsSnapshot) => void,
): () => void {
	return fullSettingsClient.subscribe(listener);
}

export function getSettingsSnapshot(forceRefresh = false): Promise<SettingsSnapshot> {
	return fullSettingsClient.getSnapshot(forceRefresh);
}

export function patchSettings(patch: SettingsPatch): Promise<SettingsSnapshot> {
	return fullSettingsClient.patch(patch);
}

export function clearSettingsSnapshotCache(): void {
	fullSettingsClient.clearCache();
}

export async function flushSettings(): Promise<void> {
	await fullSettingsClient.waitForIdle();
	const response = await sendFullSettingsRequest('spectra.settings.flush', {});
	if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
}

if (typeof window !== 'undefined') {
	const onSettingsChanged = (message: unknown): false => {
		if (isSpectraFullSettingsEventEnvelope(message)) {
			fullSettingsClient.accept(message.payload);
		}
		return false;
	};
	chrome.runtime.onMessage.addListener(onSettingsChanged);
	window.addEventListener('pagehide', () => {
		chrome.runtime.onMessage.removeListener(onSettingsChanged);
		void flushSettings().catch((error: unknown) => {
			console.error('[SPECTRA Settings] Unable to flush before pagehide:', error);
		});
	}, { once: true });
}
