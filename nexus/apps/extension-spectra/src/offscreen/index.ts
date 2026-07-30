// goal: single MV3 offscreen host entrypoint; audio and remote controllers share this document

import {
	isOffscreenHostRequest,
	type OffscreenHostWireRequest,
	type RemoteHostRequest,
} from '@nexus/contracts';
import { describeAudioHost, destroyAudioHost, handleAudioHostMessage } from './audio-host';
import type { OffscreenRemoteRuntime } from '../offscreen-remote/runtime';

let remoteRuntime: OffscreenRemoteRuntime | null = null;
let remoteRuntimeLoad: Promise<OffscreenRemoteRuntime> | null = null;
let pageClosing = false;

function ensureRemoteRuntime(): Promise<OffscreenRemoteRuntime> {
	if (remoteRuntime) return Promise.resolve(remoteRuntime);
	if (pageClosing) return Promise.reject(new Error('Offscreen host is closing'));
	if (!remoteRuntimeLoad) {
		remoteRuntimeLoad = import('../offscreen-remote/runtime')
			.then(({ createOffscreenRemoteRuntime }) => {
				if (pageClosing) throw new Error('Offscreen host is closing');
				const created = createOffscreenRemoteRuntime();
				remoteRuntime = created;
				return created;
			})
			.finally(() => {
				remoteRuntimeLoad = null;
			});
	}
	return remoteRuntimeLoad;
}

function isTrustedBackgroundSender(sender: chrome.runtime.MessageSender): boolean {
	if (sender.id !== chrome.runtime.id || sender.tab) return false;
	return sender.url === undefined || sender.url === chrome.runtime.getURL('background.js');
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
	if (!isOffscreenHostRequest(message)) return false;
	if (!isTrustedBackgroundSender(sender)) {
		sendResponse({ success: false, error: 'FORBIDDEN' });
		return false;
	}

	if (message.type === 'OFFSCREEN_HOST_HELLO') {
		sendResponse({
			audioTabs: describeAudioHost(),
			remoteTabs: remoteRuntime?.controller
				.describeSessions()
				.map(({ tabId, sessionId }) => ({ tabId, sessionId })) ?? [],
		});
		return false;
	}
	if (isRemoteHostRequest(message)) {
		return handleRemoteHostRequest(message, sendResponse);
	}

	void handleAudioHostMessage(message)
		.then(sendResponse)
		.catch((error) => sendResponse({
			success: false,
			error: error instanceof Error ? error.message : String(error),
		}));
	return true;
});

function isRemoteHostRequest(
	request: OffscreenHostWireRequest,
): request is RemoteHostRequest & { target: 'offscreen' } {
	return request.type.startsWith('REMOTE_HOST_');
}

function handleRemoteHostRequest(
	message: RemoteHostRequest,
	sendResponse: (response?: unknown) => void,
): boolean {
	if (remoteRuntime) {
		return remoteRuntime.controller.handleRuntimeMessage(message, sendResponse);
	}
	if (!remoteRuntimeLoad && message.type !== 'REMOTE_HOST_CREATE_SESSION') {
		if (message.type === 'REMOTE_HOST_GET_STATUS') sendResponse({ session: null });
		else if (message.type === 'REMOTE_HOST_DESCRIBE') sendResponse({ sessions: [] });
		else if (message.type === 'REMOTE_HOST_CLOSE_SESSION') {
			sendResponse({ success: false, error: 'SESSION_MISMATCH' });
		} else {
			sendResponse({ success: false });
		}
		return false;
	}
	void ensureRemoteRuntime()
		.then((runtime) => {
			runtime.controller.handleRuntimeMessage(message, sendResponse);
		})
		.catch((error) => sendResponse({
			success: false,
			error: error instanceof Error ? error.message : String(error),
		}));
	return true;
}

window.addEventListener('pagehide', () => {
	pageClosing = true;
	const remoteDestroy = remoteRuntime
		? remoteRuntime.destroy()
		: remoteRuntimeLoad?.then((runtime) => runtime.destroy()) ?? Promise.resolve();
	void Promise.allSettled([destroyAudioHost(), remoteDestroy]).then((results) => {
		const failures = results.flatMap((result) => (
			result.status === 'rejected' ? [result.reason] : []
		));
		if (failures.length > 0) {
			console.error(
				'[SPECTRA] Offscreen host disposal failed',
				new AggregateError(failures),
			);
		}
	});
}, { once: true });
