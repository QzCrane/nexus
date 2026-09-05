// goal: full revision-aware settings client for Popup and other full-snapshot consumers

import type {
	RpcResult,
	SettingsPatch,
	SettingsPatchRequest,
	SettingsSnapshot,
	SpectraRequestEnvelope,
	SpectraRequestPayload,
	SpectraResponse,
} from '@nexus/contracts';
import {
	isSpectraFullSettingsEventEnvelope,
	isSpectraFullSettingsResponse,
} from '@nexus/contracts/full-settings-runtime';
import { SPECTRA_PROTOCOL_VERSION } from '@nexus/contracts/ui-settings-runtime';
import {
	applyRevisionedPatchWithRetry,
	createRevisionedSettingsClient,
	selectNewestRevisionedSnapshot,
	type RevisionedSettingsTransport,
} from './revisioned-settings-client';

export type SettingsPatchRetryTransport = RevisionedSettingsTransport<SettingsSnapshot, SettingsPatch>;

type FullSettingsRequestType =
	| 'spectra.settings.get'
	| 'spectra.settings.patch'
	| 'spectra.settings.flush';

function createRequestId(): string {
	return typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: `${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(2)).join('-')}`;
}

async function sendFullSettingsRequest<T extends FullSettingsRequestType>(
	type: T,
	payload: SpectraRequestPayload<T>,
): Promise<SpectraResponse<T>> {
	const message: SpectraRequestEnvelope<T> = {
		protocolVersion: SPECTRA_PROTOCOL_VERSION,
		requestId: createRequestId(),
		type,
		payload,
	};
	const response: unknown = await chrome.runtime.sendMessage(message);
	if (!isSpectraFullSettingsResponse(type, response)) {
		throw new Error(
			`Background returned an invalid SPECTRA extension RPC v${SPECTRA_PROTOCOL_VERSION} full-settings response for ${type}`,
		);
	}
	return response;
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
