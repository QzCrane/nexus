// goal: narrow full-snapshot settings guards for Popup and preset surfaces

import { isSettingsSnapshot } from './settings.contracts.js';
import {
	hasOnlyProtocolKeys,
	hasValidEventEnvelopeBase,
	isProtocolRecord,
	isRpcError,
	isRpcFailureResult,
	isRpcSuccessResult,
} from './spectra.protocol-primitives.js';
import type {
	SpectraEventEnvelope,
	SpectraResponse,
} from './spectra.protocol.js';

export type SpectraFullSettingsRequestType =
	| 'spectra.settings.get'
	| 'spectra.settings.patch'
	| 'spectra.settings.flush';

const EVENT_KEYS = new Set([
	'protocolVersion',
	'tabId',
	'documentId',
	'generation',
	'type',
	'payload',
]);

function isFullSettingsResponseData(
	type: SpectraFullSettingsRequestType,
	value: unknown,
): boolean {
	if (type === 'spectra.settings.flush') {
		return isProtocolRecord(value)
			&& Object.keys(value).length === 1
			&& value.flushed === true;
	}
	return isSettingsSnapshot(value);
}

export function isSpectraFullSettingsResponse<T extends SpectraFullSettingsRequestType>(
	type: T,
	value: unknown,
): value is SpectraResponse<T> {
	if (isRpcSuccessResult(value)) return isFullSettingsResponseData(type, value.data);
	return isRpcFailureResult(value) && isRpcError(value.error);
}

export function isSpectraFullSettingsEventEnvelope(
	value: unknown,
): value is SpectraEventEnvelope<'spectra.settings.changed'> {
	return isProtocolRecord(value)
		&& hasValidEventEnvelopeBase(value)
		&& hasOnlyProtocolKeys(value, EVENT_KEYS)
		&& value.type === 'spectra.settings.changed'
		&& value.tabId === undefined
		&& value.documentId === undefined
		&& value.generation === undefined
		&& isSettingsSnapshot(value.payload);
}
