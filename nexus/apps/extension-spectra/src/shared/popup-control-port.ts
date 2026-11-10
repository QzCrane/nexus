// goal: strict private contract for transferring coalesced Popup controls to the
// Background-owned lifecycle before the Action Popup can be destroyed

import {
	isControlApplyAck,
	isControlOperationAck,
	isRpcError,
	isControlPatch,
	isFiniteControlValue,
	isAudioSessionSnapshot,
	type AudioSessionSnapshot,
	type ControlApplyAck,
	type ControlOperationAck,
	type ControlPatch,
	type RpcError,
	type VolumeTone,
} from '@nexus/contracts';

export const POPUP_CONTROL_PORT = 'spectra-popup-control';
export const POPUP_CONTROL_MAX_GROUPS = 2;
export const POPUP_CONTROL_READY_TIMEOUT_MS = 5_000;
const MAX_DOCUMENT_ID_LENGTH = 256;
const MAX_SESSION_ID_LENGTH = 128;

export interface PopupControlPatchGroup {
	requestedCoverage: 'active-target' | 'full';
	patch: ControlPatch;
}

export type PopupControlPortRequest =
	| {
		type: 'open';
		sessionId: string;
		tabId: number;
		documentId: string;
	}
	| {
		type: 'stage';
		sessionId: string;
		inputRevision: number;
		effectiveVolume?: number;
		presentationVolume?: number;
		tone?: VolumeTone;
		groups: PopupControlPatchGroup[];
	}
	| {
		type: 'flush';
		sessionId: string;
		throughRevision: number;
	};

export type PopupControlPortResponse = {
	type: 'settled';
	sessionId: string;
	throughRevision: number;
	volumeAck: ControlOperationAck<'effective-volume'> | null;
	fieldAcks: ControlApplyAck[];
	audioSession?: AudioSessionSnapshot;
	error: RpcError | null;
};

export type PopupControlReady = { type: 'ready'; sessionId: string };

export function isPopupControlReady(value: unknown): value is PopupControlReady {
	return isRecord(value) && hasExactKeys(value, ['type', 'sessionId'])
		&& value.type === 'ready' && isSessionId(value.sessionId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isSessionId(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= MAX_SESSION_ID_LENGTH;
}

function isRevision(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) > 0;
}

function isPatchGroup(value: unknown): value is PopupControlPatchGroup {
	return isRecord(value)
		&& hasExactKeys(value, ['requestedCoverage', 'patch'])
		&& (value.requestedCoverage === 'active-target' || value.requestedCoverage === 'full')
		&& isControlPatch(value.patch)
		&& Object.keys(value.patch).length > 0;
}

export function isPopupControlPortRequest(value: unknown): value is PopupControlPortRequest {
	if (!isRecord(value) || !isSessionId(value.sessionId)) return false;
	if (value.type === 'open') {
		return hasExactKeys(value, ['type', 'sessionId', 'tabId', 'documentId'])
			&& Number.isSafeInteger(value.tabId) && Number(value.tabId) > 0
			&& typeof value.documentId === 'string'
			&& value.documentId.length > 0 && value.documentId.length <= MAX_DOCUMENT_ID_LENGTH;
	}
	if (value.type === 'flush') {
		return hasExactKeys(value, ['type', 'sessionId', 'throughRevision'])
			&& isRevision(value.throughRevision);
	}
	if (value.type !== 'stage') return false;
	const allowed = ['type', 'sessionId', 'inputRevision'];
	if (value.effectiveVolume !== undefined) allowed.push('effectiveVolume');
	if (value.presentationVolume !== undefined) allowed.push('presentationVolume');
	if (value.tone !== undefined) allowed.push('tone');
	allowed.push('groups');
	return hasExactKeys(value, allowed)
		&& isRevision(value.inputRevision)
		&& (value.effectiveVolume === undefined || isFiniteControlValue(value.effectiveVolume, 'volume'))
		&& (value.presentationVolume === undefined && value.tone === undefined
			|| isFiniteControlValue(value.presentationVolume, 'volume')
				&& (value.tone === 'native' || value.tone === 'capture' || value.tone === 'muted'))
		&& Array.isArray(value.groups)
		&& value.groups.length <= POPUP_CONTROL_MAX_GROUPS
		&& value.groups.every(isPatchGroup)
		&& new Set(value.groups.map((group) => group.requestedCoverage)).size === value.groups.length
		&& new Set(value.groups.flatMap((group) => Object.keys(group.patch))).size
			=== value.groups.reduce((count, group) => count + Object.keys(group.patch).length, 0)
		&& (value.effectiveVolume !== undefined || value.groups.length > 0);
}

export function isPopupControlPortResponse(value: unknown): value is PopupControlPortResponse {
	if (!isRecord(value)
		|| !hasExactKeys(value, [
			'type', 'sessionId', 'throughRevision', 'volumeAck', 'fieldAcks', 'error',
			...(value.audioSession === undefined ? [] : ['audioSession']),
		])
		|| value.type !== 'settled' || !isSessionId(value.sessionId)
		|| !isRevision(value.throughRevision) || !Array.isArray(value.fieldAcks)) return false;
	return (value.volumeAck === null || (
		isControlOperationAck(value.volumeAck)
		&& value.volumeAck.operation === 'effective-volume'
	))
		&& value.fieldAcks.length <= POPUP_CONTROL_MAX_GROUPS
		&& value.fieldAcks.every(isControlApplyAck)
		&& (value.audioSession === undefined || isAudioSessionSnapshot(value.audioSession))
		&& (value.error === null || isRpcError(value.error))
		&& (value.volumeAck !== null || value.fieldAcks.length > 0 || value.error !== null);
}
