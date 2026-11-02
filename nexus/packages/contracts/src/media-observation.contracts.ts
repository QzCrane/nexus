// goal: one lightweight guard for physical media sample ordering evidence
import type { MediaObservationStamp, MediaRestoreToken } from './control.contracts.js';

export const MEDIA_OBSERVATION_FIELDS = ['volumeBase', 'mediaMuted', 'speed', 'preservePitch', 'playing', 'currentTime', 'loop'] as const;

export function isMediaRestoreToken(value: unknown): value is MediaRestoreToken {
	if (!value || typeof value !== 'object') return false;
	const record = value as Record<string, unknown>;
	return Object.keys(record).every((key) => key === 'scene' || key === 'visit' || key === 'revision')
		&& typeof record.scene === 'string' && record.scene.length > 0 && record.scene.length <= 128
		&& Number.isSafeInteger(record.visit) && Number(record.visit) >= 0
		&& Number.isSafeInteger(record.revision) && Number(record.revision) >= 0;
}

export function isMediaObservationStamp(value: unknown): value is MediaObservationStamp {
	if (!value || typeof value !== 'object') return false;
	const record = value as Record<string, unknown>;
	return Object.keys(record).every((key) => key === 'owner' || key === 'epoch' || key === 'selection' || key === 'revision')
		&& typeof record.owner === 'string' && record.owner.length > 0 && record.owner.length <= 128
		&& Number.isSafeInteger(record.epoch) && Number(record.epoch) >= 0
		&& Number.isSafeInteger(record.selection) && Number(record.selection) >= 0
		&& Number.isSafeInteger(record.revision) && Number(record.revision) >= 0;
}

/** Null means conflicting owner identity, never permission to replace facts. */
export function compareMediaObservations(incoming: MediaObservationStamp, current: MediaObservationStamp): -1 | 0 | 1 | null {
	if (incoming.epoch !== current.epoch) return incoming.epoch > current.epoch ? 1 : -1;
	if (incoming.owner !== current.owner) return null;
	if (incoming.selection < current.selection || incoming.revision < current.revision) return -1;
	return incoming.selection === current.selection && incoming.revision === current.revision ? 0 : 1;
}
