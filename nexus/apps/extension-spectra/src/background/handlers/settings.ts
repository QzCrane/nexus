// goal: handles legacy settings actions and the runtime-validated SPECTRA v2 RPC

import { router } from '../state';
import {
	SPECTRA_PROTOCOL_VERSION,
	isSpectraRequestEnvelope,
	rpcFailure,
	rpcSuccess,
} from '@nexus/contracts';
import {
	InvalidSettingsPatchError,
	SettingsRevisionConflictError,
	settingsRepository,
} from '../settings-repository';
import { withContentOSDMessages } from '../../shared/i18n/content-osd';
import {
	initializeSettingsProjection,
	scheduleSettingsProjection,
} from '../settings-projection';

function isAttemptedSettingsV2Message(message: unknown): boolean {
	if (!message || typeof message !== 'object') return false;
	const candidate = message as { protocolVersion?: unknown; type?: unknown };
	return candidate.protocolVersion === SPECTRA_PROTOCOL_VERSION
		&& (candidate.type === 'spectra.content.settings.get'
			|| candidate.type === 'spectra.settings.get'
			|| candidate.type === 'spectra.settings.patch'
			|| candidate.type === 'spectra.settings.flush'
			|| candidate.type === 'spectra.hotkeys.get');
}

function registerV2SettingsListener(): void {
	chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
		if (!isAttemptedSettingsV2Message(message)) return false;
		if (sender.id && sender.id !== chrome.runtime.id) {
			sendResponse(rpcFailure('forbidden', 'Settings RPC is extension-internal only'));
			return false;
		}
		if (!isSpectraRequestEnvelope(message)) {
			sendResponse(rpcFailure('invalid_request', 'Malformed SPECTRA v2 settings request'));
			return false;
		}

		const operation = async () => {
			try {
				if (message.type === 'spectra.content.settings.get') {
					return rpcSuccess(withContentOSDMessages(
						(await settingsRepository.getSnapshot()).globalSettings,
					));
				}
				if (message.type === 'spectra.settings.get') {
					return rpcSuccess(await settingsRepository.getSnapshot());
				}
				if (message.type === 'spectra.hotkeys.get') {
					return rpcSuccess((await settingsRepository.getSnapshot()).hotkeySettings);
				}
				if (message.type === 'spectra.settings.patch') {
					const payload = message.payload;
					const next = await settingsRepository.applyPatch(
						payload.patch,
						payload.expectedRevision,
					);
					if (payload.patch.scope === 'legacy-theme') {
						if (next.revision !== payload.expectedRevision) {
							scheduleSettingsProjection(next, 'global');
						}
					} else {
						scheduleSettingsProjection(next, payload.patch.scope);
					}
					return rpcSuccess(next);
				}
				if (message.type === 'spectra.settings.flush') {
					await settingsRepository.flush();
					return rpcSuccess({ flushed: true as const });
				}
				return rpcFailure('unsupported_request', 'No settings handler for this request');
			} catch (error) {
				if (error instanceof SettingsRevisionConflictError) {
					return rpcFailure('revision_conflict', error.message, true);
				}
				if (error instanceof InvalidSettingsPatchError) {
					return rpcFailure('invalid_patch', error.message);
				}
				const messageText = error instanceof Error ? error.message : String(error);
				return rpcFailure('settings_unavailable', messageText, true);
			}
		};

		operation()
			.then(sendResponse)
			.catch((error) => sendResponse(rpcFailure('settings_unavailable', error instanceof Error ? error.message : String(error))));
		return true;
	});
}

export function registerSettingsHandlers(): void {
	void settingsRepository.initialize();
	initializeSettingsProjection(() => settingsRepository.getSnapshot());
	registerV2SettingsListener();

	router.on('SETTINGS_GET', async () => {
		return withContentOSDMessages((await settingsRepository.getSnapshot()).globalSettings);
	});

	router.on('SETTINGS_UPDATE', async (req) => {
		const snapshot = await settingsRepository.applyPatch({ scope: 'global', changes: req.settings });
		scheduleSettingsProjection(snapshot, 'global');
		return { success: true };
	});
}
