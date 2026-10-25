// goal: bind Popup observation leases to browser-owned port lifetime, not a final pagehide message
import type { ContentRuntimeReadyResult } from '@nexus/contracts';
import { RUNTIME_OBSERVATION_PORT } from '../shared/runtime-observation';
import { isBackgroundRequestEnvelope } from './background-rpc';
import { rpcFailure, rpcSuccess } from '@nexus/contracts';
import { ensureContentRuntime, releaseContentRuntimeLease } from './runtime-loader';

interface ObservationRuntime {
	ensure: typeof ensureContentRuntime;
	release: typeof releaseContentRuntimeLease;
}

export function bindRuntimeObservationPort(
	port: chrome.runtime.Port,
	runtime: ObservationRuntime = { ensure: ensureContentRuntime, release: releaseContentRuntimeLease },
): void {
	if (port.name !== RUNTIME_OBSERVATION_PORT) return;
	if (port.sender?.id !== chrome.runtime.id || port.sender.url !== chrome.runtime.getURL('popup.html')) {
		port.disconnect();
		return;
	}
	let closed = false;
	let requested = false;
	let ready: (ContentRuntimeReadyResult & { tabId: number }) | null = null;
	// The client cannot choose a capability colliding with another port's lease.
	const capability = `popup:${crypto.randomUUID()}`;
	const release = (value: ContentRuntimeReadyResult & { tabId: number }): void => {
		runtime.release(value.tabId, value.documentId, 'observation', capability);
	};
	const close = (): void => {
		if (closed) return;
		closed = true;
		clearTimeout(deadline);
		port.onMessage.removeListener(onMessage);
		port.onDisconnect.removeListener(close);
		if (ready) release(ready);
		ready = null;
	};
	const disconnect = (): void => {
		close();
		port.disconnect();
	};
	const onMessage = (message: unknown): void => {
		if (closed) return;
		if (requested || !isBackgroundRequestEnvelope(message)
			|| message.type !== 'spectra.content.runtime.ensure'
			|| message.payload.reason !== 'observation' || !message.payload.documentId) {
			disconnect();
			return;
		}
		requested = true;
		const { tabId, documentId } = message.payload;
		void runtime.ensure(tabId, documentId, 'observation', capability).then(
			(value) => {
				const owned = { ...value, tabId };
				if (closed) { release(owned); return; }
				ready = owned;
				clearTimeout(deadline);
				try { port.postMessage(rpcSuccess(value)); }
				catch { disconnect(); }
			},
			(error) => {
				if (closed) return;
				try { port.postMessage(rpcFailure('observation_unavailable', String(error), true)); }
				catch { close(); }
				disconnect();
			},
		);
	};
	const deadline = setTimeout(disconnect, 15_000);
	port.onDisconnect.addListener(close);
	port.onMessage.addListener(onMessage);
}
