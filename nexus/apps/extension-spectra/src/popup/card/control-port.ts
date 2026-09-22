// goal: transfer continuous card controls to the Background-owned latest slot

import {
	isPopupControlPortResponse,
	isPopupControlReady,
	POPUP_CONTROL_PORT,
	POPUP_CONTROL_READY_TIMEOUT_MS,
	type PopupControlPatchGroup,
	type PopupControlPortRequest,
	type PopupControlPortResponse,
} from '../../shared/popup-control-port';

export class PopupControlChannelError extends Error {
	reported = false;
}

export function isReportedControlFailure(error: unknown): boolean {
	return error instanceof PopupControlChannelError && error.reported;
}

export interface PopupControlTransport {
	stage(input: {
		inputRevision: number;
		effectiveVolume?: number;
		groups: PopupControlPatchGroup[];
	}): void;
	flush(throughRevision: number): Promise<PopupControlPortResponse | null>;
	onSettled(listener: (response: PopupControlPortResponse) => void): () => void;
	onFailure(listener: (error: Error) => void): () => void;
	hasPendingVolume(): boolean;
	dispose(): void;
}

export function openPopupControlTransport(
	tabId: number,
	documentId: string,
): PopupControlTransport {
	const sessionId = crypto.randomUUID();
	const port = chrome.runtime.connect(chrome.runtime.id, { name: POPUP_CONTROL_PORT });
	const waiters = new Map<number, {
		resolve: (response: PopupControlPortResponse) => void;
		reject: (error: Error) => void;
	}>();
	let closed = false;
	let closeError: Error = new Error('Popup control channel closed');
	let ready = false;
	let lastStagedRevision = 0;
	let lastSettledRevision = 0;
	let pendingVolumeRevision = 0;
	const settledListeners = new Set<(response: PopupControlPortResponse) => void>();
	const failureListeners = new Set<(error: Error) => void>();
	let readyDeadline: ReturnType<typeof setTimeout> | null = null;

	const close = (): void => {
		if (closed) return;
		closed = true;
		if (readyDeadline !== null) clearTimeout(readyDeadline);
		port.onMessage.removeListener(onMessage);
		port.onDisconnect.removeListener(onDisconnect);
		for (const waiter of waiters.values()) waiter.reject(closeError);
		waiters.clear();
		settledListeners.clear();
		failureListeners.clear();
	};
	const fail = (message: string): void => {
		if (closed) return;
		const listeners = [...failureListeners];
		closeError = new PopupControlChannelError(message);
		pendingVolumeRevision = 0;
		close();
		for (const listener of listeners) {
			try { listener(closeError); }
			catch (error) { console.error('[SPECTRA Popup] Control failure projection failed', error); }
		}
	};
	const onDisconnect = (): void => fail('SPECTRA Background control channel disconnected');
	const rejectChannel = (message: string): void => {
		fail(message);
		try { port.disconnect(); }
		catch (error) { console.debug('[SPECTRA Popup] Control channel was already disconnected', error); }
		console.warn(`[SPECTRA Popup] ${message}`);
	};
	const onMessage = (raw: unknown): void => {
		if (!closed && !ready && isPopupControlReady(raw) && raw.sessionId === sessionId) {
			ready = true;
			if (readyDeadline !== null) clearTimeout(readyDeadline);
			return;
		}
		if (closed || !ready || !isPopupControlPortResponse(raw)
			|| raw.sessionId !== sessionId
			|| raw.throughRevision <= lastSettledRevision
			|| raw.throughRevision > lastStagedRevision
			|| raw.volumeAck && (
				raw.volumeAck.tabId !== tabId || raw.volumeAck.documentId !== documentId
			)
			|| raw.fieldAcks.some((ack) => ack.tabId !== tabId || ack.documentId !== documentId)) {
			rejectChannel('Background returned an invalid Popup control acknowledgement');
			return;
		}
		lastSettledRevision = raw.throughRevision;
		if (pendingVolumeRevision <= raw.throughRevision) pendingVolumeRevision = 0;
		for (const [revision, waiter] of waiters) {
			if (revision > raw.throughRevision) continue;
			waiters.delete(revision);
			waiter.resolve(raw);
		}
		for (const listener of settledListeners) {
			try { listener(raw); }
			catch (error) { console.error('[SPECTRA Popup] Control settlement projection failed', error); }
		}
	};
	const post = (message: PopupControlPortRequest): void => {
		if (closed) throw closeError;
		try { port.postMessage(message); }
		catch {
			fail('SPECTRA Background control channel disconnected');
			throw closeError;
		}
	};
	port.onMessage.addListener(onMessage);
	port.onDisconnect.addListener(onDisconnect);
	readyDeadline = setTimeout(() => rejectChannel(
		'SPECTRA Background did not acknowledge the control channel. Disable and enable SPECTRA to load the current Background.',
	), POPUP_CONTROL_READY_TIMEOUT_MS);
	post({ type: 'open', sessionId, tabId, documentId });

	return {
		stage(input): void {
			if (input.inputRevision <= lastStagedRevision) {
				throw new Error('Popup control input revision must increase');
			}
			post({ type: 'stage', sessionId, ...input });
			lastStagedRevision = input.inputRevision;
			if (input.effectiveVolume !== undefined) pendingVolumeRevision = input.inputRevision;
		},
		flush(throughRevision): Promise<PopupControlPortResponse | null> {
			if (throughRevision <= lastSettledRevision || throughRevision === 0) return Promise.resolve(null);
			if (closed) return Promise.reject(closeError);
			if (throughRevision > lastStagedRevision) {
				return Promise.reject(new Error('Popup control flush exceeds the staged revision'));
			}
			const existing = waiters.get(throughRevision);
			if (existing) {
				return new Promise((resolve, reject) => {
					const priorResolve = existing.resolve;
					const priorReject = existing.reject;
					existing.resolve = (response) => { priorResolve(response); resolve(response); };
					existing.reject = (error) => { priorReject(error); reject(error); };
				});
			}
			const result = new Promise<PopupControlPortResponse>((resolve, reject) => {
				waiters.set(throughRevision, { resolve, reject });
			});
			try { post({ type: 'flush', sessionId, throughRevision }); }
			catch { return result; }
			return result;
		},
		onSettled(listener): () => void {
			settledListeners.add(listener);
			return () => settledListeners.delete(listener);
		},
		onFailure(listener): () => void {
			failureListeners.add(listener);
			return () => failureListeners.delete(listener);
		},
		hasPendingVolume(): boolean {
			return pendingVolumeRevision > lastSettledRevision;
		},
		dispose(): void {
			if (closed) return;
			close();
			port.disconnect();
		},
	};
}
