// goal: send runtime-validated SPECTRA extension RPC requests from extension contexts
// eff: delegates to canonical transport infrastructure without duplicating envelope or lease logic

import {
	createSpectraRequest,
	isSpectraResponse,
	type SpectraRequestPayload,
	type SpectraRequestType,
	type SpectraResponse,
} from '@nexus/contracts';
import {
	deliverSpectraTabRpcMessage,
	sendSpectraRpcMessage,
	sendSpectraTabWithRuntimeLease,
	type SpectraRpcContext,
} from './transport';

export type SpectraRequestContext = SpectraRpcContext;

export function sendSpectraRequest<T extends SpectraRequestType>(
	type: T,
	payload: SpectraRequestPayload<T>,
	context: SpectraRequestContext = {},
): Promise<SpectraResponse<T>> {
	const message = createSpectraRequest(type, payload, context);
	return sendSpectraRpcMessage(message, isSpectraResponse, 'Background');
}

export function sendSpectraTabRequestOnce<T extends SpectraRequestType>(
	tabId: number,
	type: T,
	payload: SpectraRequestPayload<T>,
	context: Omit<SpectraRequestContext, 'tabId'> = {},
): Promise<SpectraResponse<T>> {
	const message = createSpectraRequest(type, payload, { ...context, tabId });
	return deliverSpectraTabRpcMessage(tabId, message, isSpectraResponse, 'Content host', context.documentId);
}

export function sendSpectraTabRequest<T extends SpectraRequestType>(
	tabId: number,
	type: T,
	payload: SpectraRequestPayload<T>,
	context: Omit<SpectraRequestContext, 'tabId'> = {},
): Promise<SpectraResponse<T>> {
	return sendSpectraTabWithRuntimeLease(
		tabId,
		type,
		payload,
		context,
		isSpectraResponse,
		'Content host',
		'control',
	);
}
