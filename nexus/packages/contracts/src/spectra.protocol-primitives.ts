// goal: one lightweight owner for SPECTRA wire-envelope and RpcResult primitives

import { SPECTRA_PROTOCOL_VERSION } from './spectra.bootstrap.js';

export { SPECTRA_PROTOCOL_VERSION };

export interface RpcError {
	code: string;
	message: string;
	retryable: boolean;
}

export type RpcResult<T> =
	| { ok: true; data: T }
	| { ok: false; error: RpcError };

export type ProtocolRecord = Record<string, unknown>;

const REQUEST_ENVELOPE_KEYS = new Set([
	'protocolVersion',
	'requestId',
	'type',
	'payload',
	'tabId',
	'documentId',
	'generation',
]);
const EVENT_ENVELOPE_KEYS = new Set([
	'protocolVersion',
	'type',
	'payload',
	'tabId',
	'documentId',
	'generation',
]);
const RPC_SUCCESS_KEYS = new Set(['ok', 'data']);
const RPC_FAILURE_KEYS = new Set(['ok', 'error']);
const RPC_ERROR_KEYS = new Set<keyof RpcError>(['code', 'message', 'retryable']);

export function isProtocolRecord(value: unknown): value is ProtocolRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasOnlyProtocolKeys(
	value: ProtocolRecord,
	allowed: ReadonlySet<string>,
): boolean {
	return Object.keys(value).every((key) => allowed.has(key));
}

export function isPositiveInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function isDocumentId(value: unknown): value is string {
	return typeof value === 'string'
		&& value.length <= 256
		&& value.trim().length > 0;
}

export function isRuntimeRevision(value: unknown): value is string {
	return typeof value === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/u.test(value);
}

export function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

export function isFiniteInRange(
	value: unknown,
	minimum: number,
	maximum: number,
): value is number {
	return isFiniteNumber(value) && value >= minimum && value <= maximum;
}

export function isOptionalFiniteInRange(
	value: unknown,
	minimum: number,
	maximum: number,
): value is number | undefined {
	return value === undefined || isFiniteInRange(value, minimum, maximum);
}

export function isEmptyPayload(value: unknown): value is Record<string, never> {
	return isProtocolRecord(value) && Object.keys(value).length === 0;
}

export function hasValidContextFields(value: ProtocolRecord): boolean {
	return (value.tabId === undefined || isPositiveInteger(value.tabId))
		&& (value.documentId === undefined || isDocumentId(value.documentId))
		&& (value.generation === undefined || isNonNegativeInteger(value.generation));
}

export function hasValidRequestEnvelopeBase(value: ProtocolRecord): boolean {
	return hasOnlyProtocolKeys(value, REQUEST_ENVELOPE_KEYS)
		&& value.protocolVersion === SPECTRA_PROTOCOL_VERSION
		&& typeof value.requestId === 'string'
		&& value.requestId.length > 0
		&& value.requestId.length <= 128
		&& hasValidContextFields(value);
}

export function hasValidEventEnvelopeBase(value: ProtocolRecord): boolean {
	return hasOnlyProtocolKeys(value, EVENT_ENVELOPE_KEYS)
		&& value.protocolVersion === SPECTRA_PROTOCOL_VERSION
		&& hasValidContextFields(value);
}

export function isRpcError(value: unknown): value is RpcError {
	return isProtocolRecord(value)
		&& hasOnlyProtocolKeys(value, RPC_ERROR_KEYS)
		&& typeof value.code === 'string'
		&& value.code.length > 0
		&& value.code.length <= 128
		&& typeof value.message === 'string'
		&& value.message.length > 0
		&& value.message.length <= 4096
		&& typeof value.retryable === 'boolean';
}

export type RpcSuccessResult = { ok: true; data: unknown };
export type RpcFailureResult = { ok: false; error: unknown };

export function isRpcSuccessResult(value: unknown): value is RpcSuccessResult {
	return isProtocolRecord(value)
		&& hasOnlyProtocolKeys(value, RPC_SUCCESS_KEYS)
		&& value.ok === true
		&& Object.hasOwn(value, 'data');
}

export function isRpcFailureResult(value: unknown): value is RpcFailureResult {
	return isProtocolRecord(value)
		&& hasOnlyProtocolKeys(value, RPC_FAILURE_KEYS)
		&& value.ok === false
		&& Object.hasOwn(value, 'error');
}
