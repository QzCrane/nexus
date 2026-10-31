// goal: own latest-value Popup controls beyond the Action Popup realm lifetime

import type { ControlApplyAck, ControlOperationAck, ControlPatch, RpcError } from '@nexus/contracts';
import {
	isPopupControlPortRequest,
	POPUP_CONTROL_PORT,
	type PopupControlPatchGroup,
	type PopupControlPortResponse,
	type PopupControlReady,
} from '../shared/popup-control-port';
import { updateBadgeStagedVolume } from './handlers/badge';

const COALESCE_MS = 50;
let receivedInputs = 0;
let pendingBatches = 0;
let failedBatches = 0;

// The user-facing control latency is intent-to-settled-response, and Background
// is the only place that can observe both ends of it without a new protocol
// message. Samples are bounded so diagnostics stay a fixed-size projection.
const SETTLE_SAMPLE_LIMIT = 128;
let settleSamples: number[] = [];

export function appendBoundedSample(
	samples: readonly number[],
	value: number,
	limit: number,
): number[] {
	const next = [...samples, value];
	return next.length > limit ? next.slice(next.length - limit) : next;
}

export function summarizeSettleLatency(samples: readonly number[]): {
	p50: number;
	p95: number;
	max: number;
} {
	if (samples.length === 0) return { p50: 0, p95: 0, max: 0 };
	const sorted = [...samples].sort((left, right) => left - right);
	const at = (quantile: number): number => sorted[
		Math.min(sorted.length - 1, Math.max(0, Math.ceil(quantile * sorted.length) - 1))
	] ?? 0;
	return { p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] ?? 0 };
}

export function getPopupControlDiagnostics(): Record<string, number> {
	const settle = summarizeSettleLatency(settleSamples);
	return {
		popupControlReceivedInputs: receivedInputs,
		popupControlPendingBatches: pendingBatches,
		popupControlFailedBatches: failedBatches,
		popupControlSettleSamples: settleSamples.length,
		popupControlSettleP50Ms: settle.p50,
		popupControlSettleP95Ms: settle.p95,
		popupControlSettleMaxMs: settle.max,
	};
}

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
		pendingBatches++;
		const settleStartedAt = performance.now();
		const recordSettle = (): void => {
			settleSamples = appendBoundedSample(
				settleSamples,
				performance.now() - settleStartedAt,
				SETTLE_SAMPLE_LIMIT,
			);
		};
		inFlight = runner.submit(batch).then(
			(result) => {
				recordSettle();
				if (result.error) failedBatches = Math.min(Number.MAX_SAFE_INTEGER, failedBatches + 1);
				postSettled(batch.inputRevision, result);
			},
			(error: unknown) => {
				recordSettle();
				failedBatches = Math.min(Number.MAX_SAFE_INTEGER, failedBatches + 1);
				postSettled(batch.inputRevision, {
				volumeAck: null,
				fieldAcks: [],
				error: {
					code: 'popup_control_failed',
					message: error instanceof Error ? error.message : String(error),
					retryable: true,
				},
				});
			},
		).finally(() => {
			pendingBatches--;
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
			try { port.postMessage({ type: 'ready', sessionId: raw.sessionId } satisfies PopupControlReady); }
			catch { close(); }
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
		receivedInputs = Math.min(Number.MAX_SAFE_INTEGER, receivedInputs + 1);
		lastAcceptedRevision = raw.inputRevision;
		if (raw.effectiveVolume !== undefined) {
			volume = { revision: raw.inputRevision, value: raw.effectiveVolume };
			if (identity) {
				updateBadgeStagedVolume(identity.tabId, raw.effectiveVolume, {
					documentId: identity.documentId,
					origin: '',
					generation: 0,
				});
			}
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
