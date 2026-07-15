// goal: send runtime-validated SPECTRA v2 requests from extension contexts

import {
	SPECTRA_PROTOCOL_VERSION,
	isSpectraResponse,
	type SpectraRequestEnvelope,
	type SpectraRequestPayload,
	type SpectraRequestType,
	type SpectraResponse,
} from '@nexus/contracts';

export interface SpectraRequestContext {
	tabId?: number;
	documentId?: string;
	generation?: number;
}

function createRequestId(): string {
	return typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: `${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(2)).join('-')}`;
}

function createEnvelope<T extends SpectraRequestType>(
	type: T,
	payload: SpectraRequestPayload<T>,
	context: SpectraRequestContext,
): SpectraRequestEnvelope<T> {
	return {
		protocolVersion: SPECTRA_PROTOCOL_VERSION,
		requestId: createRequestId(),
		type,
		payload,
		...context,
	} as SpectraRequestEnvelope<T>;
}

function validateResponse<T extends SpectraRequestType>(
	type: T,
	response: unknown,
): SpectraResponse<T> {
	if (!isSpectraResponse(type, response)) {
		throw new Error('Peer returned an invalid SPECTRA v2 response');
	}
	return response;
}

export async function sendSpectraRequest<T extends SpectraRequestType>(
	type: T,
	payload: SpectraRequestPayload<T>,
	context: SpectraRequestContext = {},
): Promise<SpectraResponse<T>> {
	const message = createEnvelope(type, payload, context);
	const response: unknown = await chrome.runtime.sendMessage(message);
	return validateResponse(type, response);
}

export async function sendSpectraTabRequest<T extends SpectraRequestType>(
	tabId: number,
	type: T,
	payload: SpectraRequestPayload<T>,
	context: Omit<SpectraRequestContext, 'tabId'> = {},
): Promise<SpectraResponse<T>> {
	const message = createEnvelope(type, payload, { ...context, tabId });
	const response: unknown = await chrome.tabs.sendMessage(tabId, message);
	return validateResponse(type, response);
}
