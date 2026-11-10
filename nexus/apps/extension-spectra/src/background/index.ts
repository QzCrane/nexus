// goal: service worker entry point for SPECTRA
// note: coordinates message routing between popup, content script, offscreen, and remote services

import { registerAudioHandlers } from './handlers/audio';
import { registerSettingsHandlers } from './handlers/settings';
import { registerCaptureHandlers } from './handlers/capture';
import { registerHotkeyTargetHandlers } from './handlers/hotkey-target';
import { registerRegistryHandlers } from './handlers/registry';
import { registerTabStateHandlers } from './handlers/tab-state';
import { registerUserScriptsHandler } from './handlers/user-scripts';
import { registerCommandHandlers } from './handlers/commands';
import { registerScreenshotHandler } from './handlers/screenshot';
import { setupShortcutListeners } from './shortcuts';
import { setupLifecycleListeners } from './lifecycle';
import { initRemoteService } from './remote-service';
import { performWarmUpdate } from './upgrade-manager';
import { swLog } from '../shared/logger';
import { isBackgroundRequestType } from './background-rpc';
import { hasValidRequestEnvelopeBase, isProtocolRecord, rpcFailure } from '@nexus/contracts';
import {
	initializeOffscreenCoordinator,
	retireLegacyOffscreenDocument,
} from './offscreen-coordinator';
import { initializeContentRuntimeLoader } from './runtime-loader';
import { bindRuntimeObservationPort } from './runtime-observation';
import { bindPopupControlPort } from './popup-control-port';
import { initializeRuntimeRestartRecovery } from './runtime-restart-startup';
import { initializeMainRuntimeManager } from './main-runtime-manager';
import { initializeControlCoordinator, submitPopupControlBatch, resolvePopupControlPresentationIdentity } from './control-coordinator';
import { initializeBackgroundDiagnostics } from './diagnostics';
import { initializeActionPopupFrames } from './popup-frame';

// eff: initialize all functional modules and start message routing
initializeOffscreenCoordinator();
initializeMainRuntimeManager();
initializeContentRuntimeLoader();
chrome.runtime.onConnect.addListener(bindRuntimeObservationPort);
chrome.runtime.onConnect.addListener((port) => bindPopupControlPort(port, {
	submit: submitPopupControlBatch,
	resolveIdentity: resolvePopupControlPresentationIdentity,
}));
initializeControlCoordinator();
initializeBackgroundDiagnostics();
registerAudioHandlers();
registerSettingsHandlers();
registerCaptureHandlers();
registerHotkeyTargetHandlers();
registerRegistryHandlers();
registerTabStateHandlers();
registerUserScriptsHandler();
registerCommandHandlers();
registerScreenshotHandler();
initRemoteService();

// Registered last so every owner handler answers first. A well-formed request
// envelope whose type no longer exists (a retired RPC or a stale sender) must
// fail with an explicit envelope instead of resolving `undefined` on the
// caller, which surfaces as an opaque "invalid response" error.
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
	if (!isProtocolRecord(message) || !hasValidRequestEnvelopeBase(message)) return false;
	if (sender.id !== chrome.runtime.id) return false;
	if (isBackgroundRequestType(message.type)) return false;
	sendResponse(rpcFailure(
		'unsupported_request',
		`No background handler for SPECTRA request type ${String(message.type)}`,
	));
	return false;
});

setupShortcutListeners();
setupLifecycleListeners();
// The Action Popup's size is decided before it opens, from the card count this
// keeps in each active tab's popup URL; see `popup-frame.ts`.
initializeActionPopupFrames();
initializeRuntimeRestartRecovery();

// eff: performs zero-refresh update on existing tabs when extension is updated
chrome.runtime.onInstalled.addListener(async (details) => {
	if (details.reason === 'install') {
		/* @__PURE__ */ swLog.info('Installed: runtime owners initialized');
	} else if (details.reason === 'update') {
		/* @__PURE__ */ swLog.info(`Updated from ${details.previousVersion} to ${chrome.runtime.getManifest().version}`);
		try {
			// v1 used a six-character peer ID as the credential. Its in-memory
			// offscreen host is deliberately destroyed before any v2 warm refresh.
			await retireLegacyOffscreenDocument();
			await performWarmUpdate();
		} catch (error) {
			swLog.error('Warm update failed', error);
		}
	}
});

/* @__PURE__ */ swLog.info('Background Service Worker started.');
