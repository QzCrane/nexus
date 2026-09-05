// SPECTRA Remote v3 page/public wire surface. Authenticated offscreen hosts
// import protocol-core directly so page-only validators stay out of that
// deferred runtime closure.

import { isRemotePublicSession, isRemoteState, type RemoteState } from '@nexus/contracts';
import {
	isRemoteSessionEpoch,
	isSessionId,
	type RemoteAuthenticateMessage,
	type RemoteChallengeMessage,
	type RemoteCommandMessage,
	type RemotePairing,
} from './protocol-core';
import { REMOTE_PROTOCOL_VERSION } from './protocol-version';

export {
	REMOTE_AUTH_TIMEOUT_MS,
	REMOTE_COMMANDS,
	REMOTE_PAIRING_TTL_MS,
	REMOTE_RECONNECT_TTL_MS,
	createRemotePairing,
	createRemoteProof,
	decodeBase64Url,
	encodeBase64Url,
	generateRandomToken,
	isNonce,
	isRemoteAuthenticateMessage,
	isRemoteCommand,
	isRemoteCommandId,
	isRemoteCommandMessage,
	isRemoteSessionEpoch,
	isSessionId,
	remoteChallengePayload,
	verifyRemoteProof,
} from './protocol-core';
export { REMOTE_PROTOCOL_VERSION } from './protocol-version';
export type {
	RemoteAuthenticateMessage,
	RemoteChallengeMessage,
	RemoteCommand,
	RemoteCommandMessage,
	RemotePairing,
	RemoteState,
} from './protocol-core';
export type { RemotePublicSession } from '@nexus/contracts';

export type RemoteAuthResultMessage =
	| {
		type: 'spectra.remote.auth-result';
		protocolVersion: typeof REMOTE_PROTOCOL_VERSION;
		sessionId: string;
		ok: true;
		sessionEpoch: number;
		reconnectUntil: number;
		error?: never;
	}
	| {
		type: 'spectra.remote.auth-result';
		protocolVersion: typeof REMOTE_PROTOCOL_VERSION;
		sessionId: string;
		ok: false;
		error: 'AUTH_FAILED' | 'EXPIRED' | 'ALREADY_CONNECTED' | 'INVALID_MESSAGE';
		sessionEpoch?: never;
		reconnectUntil?: never;
	};

export interface RemoteStateMessage extends RemoteState {
	type: 'spectra.remote.state';
	protocolVersion: typeof REMOTE_PROTOCOL_VERSION;
	sessionId: string;
	sessionEpoch: number;
}

export interface RemoteClosedMessage {
	type: 'spectra.remote.closed';
	protocolVersion: typeof REMOTE_PROTOCOL_VERSION;
	sessionId: string;
	sessionEpoch: number;
	reason: 'manual' | 'tab-closed' | 'pairing-expired' | 'reconnect-expired' | 'host-destroyed';
}

export type RemoteWireMessage =
	| RemoteChallengeMessage
	| RemoteAuthenticateMessage
	| RemoteAuthResultMessage
	| RemoteCommandMessage
	| RemoteStateMessage
	| RemoteClosedMessage;

export function isRemotePairing(value: unknown): value is RemotePairing {
	if (!isRecord(value)) return false;
	return isRemotePublicSession({
		protocolVersion: value.protocolVersion,
		sessionId: value.sessionId,
		peerId: value.peerId,
		secret: value.secret,
		createdAt: value.createdAt,
		pairingExpiresAt: value.pairingExpiresAt,
		tabId: 1,
		connected: false,
	});
}

export function isRemoteAuthResultMessage(value: unknown): value is RemoteAuthResultMessage {
	if (!isRecord(value)
		|| value.type !== 'spectra.remote.auth-result'
		|| value.protocolVersion !== REMOTE_PROTOCOL_VERSION
		|| !isSessionId(value.sessionId)) return false;
	if (value.ok === true) {
		return hasOnlyKeys(value, [
			'type',
			'protocolVersion',
			'sessionId',
			'ok',
			'sessionEpoch',
			'reconnectUntil',
		])
			&& isRemoteSessionEpoch(value.sessionEpoch)
			&& (value.sessionEpoch as number) > 0
			&& Number.isSafeInteger(value.reconnectUntil)
			&& (value.reconnectUntil as number) >= 0;
	}
	return hasOnlyKeys(value, ['type', 'protocolVersion', 'sessionId', 'ok', 'error'])
		&& value.ok === false
		&& (value.error === 'AUTH_FAILED'
			|| value.error === 'EXPIRED'
			|| value.error === 'ALREADY_CONNECTED'
			|| value.error === 'INVALID_MESSAGE');
}

export function isRemoteStateMessage(value: unknown): value is RemoteStateMessage {
	if (!isRecord(value)
		|| value.type !== 'spectra.remote.state'
		|| value.protocolVersion !== REMOTE_PROTOCOL_VERSION
		|| !isSessionId(value.sessionId)
		|| !isRemoteSessionEpoch(value.sessionEpoch)) return false;
	const { type: _type, protocolVersion: _version, sessionId: _sessionId, sessionEpoch, ...state } = value;
	void _type;
	void _version;
	void _sessionId;
	void sessionEpoch;
	return isRemoteState(state);
}

export function isRemoteClosedMessage(value: unknown): value is RemoteClosedMessage {
	return isRecord(value)
		&& hasOnlyKeys(value, ['type', 'protocolVersion', 'sessionId', 'sessionEpoch', 'reason'])
		&& value.type === 'spectra.remote.closed'
		&& value.protocolVersion === REMOTE_PROTOCOL_VERSION
		&& isSessionId(value.sessionId)
		&& isRemoteSessionEpoch(value.sessionEpoch)
		&& (value.reason === 'manual'
			|| value.reason === 'tab-closed'
			|| value.reason === 'pairing-expired'
			|| value.reason === 'reconnect-expired'
			|| value.reason === 'host-destroyed');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const allowed = new Set(keys);
	return Object.keys(value).every((key) => allowed.has(key));
}
