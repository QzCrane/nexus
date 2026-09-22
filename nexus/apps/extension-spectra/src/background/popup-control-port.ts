// goal: own latest-value Popup controls beyond the Action Popup realm lifetime

import type { ControlApplyAck, ControlOperationAck, ControlPatch, RpcError } from '@nexus/contracts';
import {
	isPopupControlPortRequest,
	POPUP_CONTROL_PORT,
	type PopupControlPatchGroup,
	type PopupControlPortResponse,
} from '../shared/popup-control-port';

const COALESCE_MS = 50;

export interface PopupControlBatch {
	tabId: number;
	documentId: string;
	inputRevision: number;
	effectiveVolume: number | null;
	groups: PopupControlPatchGroup[];
}

export interface PopupControlBatchResult {
	volumeAck: ControlOperationAck<'effective-volume'> | null;
	fieldAcks: ControlApplyAck[];
	error: RpcError | null;
}

export interface PopupControlRunner {
	submit(batch: PopupControlBatch): Promise<PopupControlBatchResult>;
}

interface StagedValue<T> {
	revision: number;
	value: T;
}

export function bindPopupControlPort(port: chrome.runtime.Port, runner: PopupControlRunner): void {
	if (port.name !== POPUP_CONTROL_PORT) return;
	if (port.sender?.id !== chrome.runtime.id
		|| port.sender.url !== chrome.runtime.getURL('popup.html')
		|| port.sender.tab !== undefined) {
		port.disconnect();
		return;
	}
	let identity: { sessionId: string; tabId: number; documentId: string } | null = null;
	let closed = false;
	let lastAcceptedRevision = 0;
	let volume: StagedValue<number> | null = null;
	const fields = new Map<keyof ControlPatch, StagedValue<unknown> & {
		coverage: PopupControlPatchGroup['requestedCoverage'];
	}>();
	let timer: ReturnType<typeof setTimeout> | null = null;
	let inFlight: Promise<void> | null = null;
	let flushThroughRevision = 0;

	const postSettled = (
		throughRevision: number,
		result: PopupControlBatchResult,
	): void => {
		if (closed || !identity) return;
		const response: PopupControlPortResponse = {
			type: 'settled',
			sessionId: identity.sessionId,
			throughRevision,
			volumeAck: result.volumeAck,
			fieldAcks: result.fieldAcks,
			error: result.error,
		};
		try { port.postMessage(response); }
		catch { close(); }
	};

	const takeBatch = (): PopupControlBatch | null => {
		if (!identity || (!volume && fields.size === 0)) return null;
		let inputRevision = volume?.revision ?? 0;
		const target: ControlPatch = {};
		const full: ControlPatch = {};
		for (const [field, staged] of fields) {
			inputRevision = Math.max(inputRevision, staged.revision);
			(staged.coverage === 'full' ? full : target)[field] = staged.value as never;
		}
		const batch: PopupControlBatch = {
			tabId: identity.tabId,
			documentId: identity.documentId,
			inputRevision,
			effectiveVolume: volume?.value ?? null,
			groups: [
				...(Object.keys(target).length > 0 ? [{ requestedCoverage: 'active-target' as const, patch: target }] : []),
				...(Object.keys(full).length > 0 ? [{ requestedCoverage: 'full' as const, patch: full }] : []),
			],
		};
		volume = null;
		fields.clear();
		return batch;
	};

	const run = (): void => {
		if (inFlight) return;
		if (timer) { clearTimeout(timer); timer = null; }
		const batch = takeBatch();
		if (!batch) return;
		inFlight = runner.submit(batch).then(
			(result) => postSettled(batch.inputRevision, result),
			(error: unknown) => postSettled(batch.inputRevision, {
				volumeAck: null,
				fieldAcks: [],
				error: {
					code: 'popup_control_failed',
					message: error instanceof Error ? error.message : String(error),
					retryable: true,
				},
			}),
		).finally(() => {
			inFlight = null;
			if (volume || fields.size > 0) run();
		});
	};

	const schedule = (): void => {
		if (inFlight || timer) return;
		timer = setTimeout(run, flushThroughRevision >= lastAcceptedRevision ? 0 : COALESCE_MS);
	};

	const close = (): void => {
		if (closed) return;
		closed = true;
		if (timer) { clearTimeout(timer); timer = null; }
		port.onMessage.removeListener(onMessage);
		port.onDisconnect.removeListener(close);
		// Every staged value was accepted while the trusted Port was alive. The
		// browser-owned disconnect only retires the response channel; Background
		// continues the already-owned latest batch through the coordinator.
		run();
	};

	const rejectPort = (): void => {
		close();
		try { port.disconnect(); }
		catch (error) { console.debug('[SPECTRA Background] Popup control Port was already disconnected', error); }
	};

	const onMessage = (raw: unknown): void => {
		if (closed || !isPopupControlPortRequest(raw)) { rejectPort(); return; }
		if (raw.type === 'open') {
			if (identity) { rejectPort(); return; }
			identity = { sessionId: raw.sessionId, tabId: raw.tabId, documentId: raw.documentId };
			return;
		}
		if (!identity || raw.sessionId !== identity.sessionId) { rejectPort(); return; }
		if (raw.type === 'flush') {
			if (raw.throughRevision > lastAcceptedRevision) { rejectPort(); return; }
			flushThroughRevision = Math.max(flushThroughRevision, raw.throughRevision);
			run();
			return;
		}
		if (raw.inputRevision <= lastAcceptedRevision) { rejectPort(); return; }
		lastAcceptedRevision = raw.inputRevision;
		if (raw.effectiveVolume !== undefined) {
			volume = { revision: raw.inputRevision, value: raw.effectiveVolume };
		}
		for (const group of raw.groups) {
			for (const [rawField, value] of Object.entries(group.patch)) {
				fields.set(rawField as keyof ControlPatch, {
					revision: raw.inputRevision,
					value,
					coverage: group.requestedCoverage,
				});
			}
		}
		schedule();
	};

	port.onMessage.addListener(onMessage);
	port.onDisconnect.addListener(close);
}
