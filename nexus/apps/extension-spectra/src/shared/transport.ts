// goal: canonical SPECTRA RPC delivery policy (send + runtime lease), never envelope ownership
// rule: request wire identity is owned by @nexus/contracts (spectra.wire.ts)

import {
	createSpectraRequest,
	isSpectraResponse,
	SPECTRA_PROTOCOL_VERSION,
	type SpectraRequestEnvelope,
	type SpectraRequestPayload,
	type SpectraRequestType,
	type SpectraResponse,
	type SpectraWireContext,
} from '@nexus/contracts';
import { requiresContentRuntime } from './content-runtime';
import { RPC_DEADLINE_MS, withDeadline } from './timeout';

export type SpectraRpcContext = SpectraWireContext;

export async function sendSpectraRpcMessage<T extends SpectraRequestType, R extends SpectraResponse<T>>(
	message: SpectraRequestEnvelope<T>,
	validator: (type: T, response: unknown) => response is R,
	errorPrefix: string,
	deadlineMs: number = RPC_DEADLINE_MS.backgroundRequest,
): Promise<R> {
	const response: unknown = await withDeadline(
		chrome.runtime.sendMessage(message),
		deadlineMs,
		`${errorPrefix} ${message.type}`,
	);
	if (!validator(message.type, response)) {
		throw new Error(
			`${errorPrefix} returned an invalid SPECTRA extension RPC v${SPECTRA_PROTOCOL_VERSION} response for ${message.type}`,
		);
	}
	return response;
}

export async function deliverSpectraTabRpcMessage<T extends SpectraRequestType, R extends SpectraResponse<T>>(
	tabId: number,
	message: SpectraRequestEnvelope<T>,
	validator: (type: T, response: unknown) => response is R,
	errorPrefix: string,
	documentId?: string,
	deadlineMs: number = RPC_DEADLINE_MS.contentRuntime,
): Promise<R> {
	const delivery = documentId
		? chrome.tabs.sendMessage(tabId, message, { documentId })
		: chrome.tabs.sendMessage(tabId, message);
	const response: unknown = await withDeadline(delivery, deadlineMs, `${errorPrefix} ${message.type}`);
	if (!validator(message.type, response)) {
		throw new Error(
			`${errorPrefix} returned an invalid SPECTRA extension RPC v${SPECTRA_PROTOCOL_VERSION} response for ${message.type}`,
		);
	}
	return response;
}

export async function sendSpectraTabWithRuntimeLease<
	T extends SpectraRequestType,
	R extends SpectraResponse<T>,
>(
	tabId: number,
	type: T,
	payload: SpectraRequestPayload<T>,
	context: Omit<SpectraRpcContext, 'tabId'>,
	validator: (type: T, response: unknown) => response is R,
	errorPrefix: string,
	defaultReason: 'observation' | 'control' | 'hotkey' = 'control',
): Promise<R> {
	const message = createSpectraRequest(type, payload, { ...context, tabId });
	const deliver = (documentId?: string): Promise<R> =>
		deliverSpectraTabRpcMessage(tabId, message, validator, errorPrefix, documentId);

	try {
		const firstResponse = await deliver(context.documentId);
		if (
			firstResponse.ok ||
			firstResponse.error.code !== 'content_runtime_not_loaded' ||
			!requiresContentRuntime(type)
		) {
			return firstResponse;
		}
	} catch (error) {
		if (!requiresContentRuntime(type)) throw error;
	}

	const reason = type === 'spectra.hotkey.trigger' ? 'hotkey' : defaultReason;
	const capability = `request:${message.requestId}`;

	const ensureEnvelope = createSpectraRequest('spectra.content.runtime.ensure', {
		tabId,
		...(context.documentId ? { documentId: context.documentId } : {}),
		reason,
		capability,
	});
	const ensureResponse = await sendSpectraRpcMessage(
		ensureEnvelope,
		isSpectraResponse,
		'Background',
	);

	if (!ensureResponse.ok) {
		return { ok: false, error: ensureResponse.error } as R;
	}

	try {
		return await deliver(ensureResponse.data.documentId);
	} finally {
		const releaseEnvelope = createSpectraRequest('spectra.content.runtime.release', {
			runtimeRevision: ensureResponse.data.runtimeRevision,
			tabId,
			documentId: ensureResponse.data.documentId,
			reason,
			capability,
		});
		void chrome.runtime.sendMessage(releaseEnvelope).catch(() => undefined);
	}
}
