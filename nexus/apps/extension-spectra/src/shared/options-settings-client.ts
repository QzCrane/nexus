// goal: Options-only revisioned settings client that never transports audio settings
// eff: delegates envelope creation and message dispatch to canonical transport

import {
	isSpectraSettingsUiEventEnvelope,
	isSpectraSettingsUiResponse,
	type SettingsUiPatch,
	type SettingsUiSnapshot,
	type SpectraSettingsUiRequestType,
} from '@nexus/contracts/ui-settings-runtime';
import {
	createSpectraRequest,
	type SpectraRequestPayload,
	type SpectraResponse,
} from '@nexus/contracts';
import {
	createRevisionedSettingsClient,
	type RevisionedSettingsTransport,
} from './revisioned-settings-client';
import { sendSpectraRpcMessage } from './transport';

type OptionsSettingsRequestType = Extract<
	SpectraSettingsUiRequestType,
	'spectra.settings.ui.get' | 'spectra.settings.ui.patch' | 'spectra.settings.flush'
>;

function sendOptionsSettingsRequest<T extends OptionsSettingsRequestType>(
	type: T,
	payload: SpectraRequestPayload<T>,
): Promise<SpectraResponse<T>> {
	const message = createSpectraRequest(type, payload);
	return sendSpectraRpcMessage(message, isSpectraSettingsUiResponse, 'Background');
}

const optionsSettingsTransport: RevisionedSettingsTransport<SettingsUiSnapshot, SettingsUiPatch> = {
	async getSnapshot(): Promise<SettingsUiSnapshot> {
		const result = await sendOptionsSettingsRequest('spectra.settings.ui.get', {});
		if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
		return result.data;
	},
	sendPatch(request) {
		return sendOptionsSettingsRequest('spectra.settings.ui.patch', request);
	},
};

const optionsSettingsClient = createRevisionedSettingsClient<SettingsUiSnapshot, SettingsUiPatch>(
	optionsSettingsTransport,
);

export function subscribeOptionsSettingsSnapshots(
	listener: (snapshot: SettingsUiSnapshot) => void,
): () => void {
	return optionsSettingsClient.subscribe(listener);
}

export function getOptionsSettingsSnapshot(forceRefresh = false): Promise<SettingsUiSnapshot> {
	return optionsSettingsClient.getSnapshot(forceRefresh);
}

export function patchOptionsSettings(patch: SettingsUiPatch): Promise<SettingsUiSnapshot> {
	return optionsSettingsClient.patch(patch);
}

export function clearOptionsSettingsSnapshotCache(): void {
	optionsSettingsClient.clearCache();
}

export async function flushOptionsSettings(): Promise<void> {
	await optionsSettingsClient.waitForIdle();
	const response = await sendOptionsSettingsRequest('spectra.settings.flush', {});
	if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
}

if (typeof window !== 'undefined') {
	const onSettingsChanged = (message: unknown): false => {
		if (isSpectraSettingsUiEventEnvelope(message)) {
			optionsSettingsClient.accept(message.payload);
		}
		return false;
	};
	chrome.runtime.onMessage.addListener(onSettingsChanged);
	window.addEventListener('pagehide', () => {
		chrome.runtime.onMessage.removeListener(onSettingsChanged);
		void flushOptionsSettings().catch((error: unknown) => {
			console.error('[SPECTRA Options] Unable to flush before pagehide:', error);
		});
	}, { once: true });
}
