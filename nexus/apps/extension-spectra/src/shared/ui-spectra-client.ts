// goal: send runtime-validated SPECTRA extension RPC requests from unprivileged UI surfaces
// eff: delegates to canonical transport infrastructure without duplicating envelope or lease logic

import {
	createSpectraRequest,
	type SpectraRequestPayload,
	type SpectraResponse,
} from '@nexus/contracts';
import {
	isSpectraUiResponse,
	type SpectraUiRequestType,
} from '@nexus/contracts/ui-runtime';
import {
	sendSpectraRpcMessage,
	sendSpectraTabWithRuntimeLease,
	type SpectraRpcContext,
} from './transport';

export type SpectraUiRequestContext = SpectraRpcContext;

export function sendSpectraRequest<T extends SpectraUiRequestType>(
	type: T,
	payload: SpectraRequestPayload<T>,
	context: SpectraUiRequestContext = {},
): Promise<SpectraResponse<T>> {
	const message = createSpectraRequest(type, payload, context);
	return sendSpectraRpcMessage(message, isSpectraUiResponse, 'Background');
}

export function sendSpectraTabRequest<T extends SpectraUiRequestType>(
	tabId: number,
	type: T,
	payload: SpectraRequestPayload<T>,
	context: Omit<SpectraUiRequestContext, 'tabId'> = {},
): Promise<SpectraResponse<T>> {
	return sendSpectraTabWithRuntimeLease(
		tabId,
		type,
		payload,
		context,
		isSpectraUiResponse,
		'Content host',
		'observation',
	);
}
