// goal: single owner of SPECTRA wire identity — protocol version stamping and request-id minting
// rule: extension contexts never package envelopes or generate request ids on their own;
//       a protocol bump or id strategy change touches exactly this file.
// note: only `import type` is used here, so this owner has no runtime dependency cycle.

import type {
	SpectraEventEnvelope,
	SpectraEventPayload,
	SpectraEventType,
	SpectraRequestEnvelope,
	SpectraRequestPayload,
	SpectraRequestType,
} from './spectra.protocol.js';

export const SPECTRA_PROTOCOL_VERSION = 2 as const;

export interface SpectraWireContext {
	tabId?: number;
	documentId?: string;
	generation?: number;
}

function createRequestId(): string {
	return typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: `${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(2)).join('-')}`;
}

/** Creates the only canonical request envelope shape; callers supply domain payload and context. */
export function createSpectraRequest<T extends SpectraRequestType>(
	type: T,
	payload: SpectraRequestPayload<T>,
	context: SpectraWireContext = {},
): SpectraRequestEnvelope<T> {
	return {
		protocolVersion: SPECTRA_PROTOCOL_VERSION,
		requestId: createRequestId(),
		type,
		payload,
		...context,
	} as SpectraRequestEnvelope<T>;
}

/** Creates the only canonical event envelope shape; events carry the protocol version without a request id. */
export function createSpectraEvent<T extends SpectraEventType>(
	type: T,
	payload: SpectraEventPayload<T>,
	context: SpectraWireContext = {},
): SpectraEventEnvelope<T> {
	return {
		protocolVersion: SPECTRA_PROTOCOL_VERSION,
		type,
		payload,
		...context,
	} as SpectraEventEnvelope<T>;
}
