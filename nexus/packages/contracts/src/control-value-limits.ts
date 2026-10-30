// goal: one executable owner for finite numeric control-value boundaries

import { keySetOf } from './key-set.js';

export interface ControlValueLimit {
	readonly min: number;
	readonly max: number;
}

// Interaction increments are intentionally not part of this contract. A
// slider, wheel gesture, hotkey, and remote action may use different steps,
// while every producer and guard must agree on the same legal value range.
export const CONTROL_VALUE_LIMITS = {
	volume: { min: 0, max: 800 },
	// Physical page controllers may expose their own amplified 0-800 scale.
	// Standard HTMLMediaElement.volume remains bounded by `volumeBase` below.
	nativeVolume: { min: 0, max: 800 },
	volumeBase: { min: 0, max: 100 },
	boost: { min: 1, max: 8 },
	eqBand: { min: -12, max: 12 },
	pan: { min: -1, max: 1 },
	delay: { min: 0, max: 500 },
	speed: { min: 0.1, max: 16 },
	dimOpacity: { min: 0, max: 1 },
	currentTime: { min: 0, max: Number.MAX_SAFE_INTEGER },
} as const satisfies Record<string, ControlValueLimit>;

export type ControlValueLimitName = keyof typeof CONTROL_VALUE_LIMITS;

export function isFiniteControlValue(
	value: unknown,
	limitName: ControlValueLimitName,
): value is number {
	const limit = CONTROL_VALUE_LIMITS[limitName];
	return typeof value === 'number'
		&& Number.isFinite(value)
		&& value >= limit.min
		&& value <= limit.max;
}

export function clampControlValue(
	value: number,
	limitName: ControlValueLimitName,
	fallback: number,
): number {
	const limit = CONTROL_VALUE_LIMITS[limitName];
	const finiteValue = Number.isFinite(value) ? value : fallback;
	return Math.max(limit.min, Math.min(limit.max, finiteValue));
}

export function compileEffectiveVolume(volumeBase: number, boost: number): number {
	const base = clampControlValue(volumeBase, 'nativeVolume', 100);
	const multiplier = clampControlValue(boost, 'boost', 1);
	return clampControlValue(Math.round(base * multiplier * 100) / 100, 'volume', 100);
}

export function splitEffectiveVolume(volume: number): { volumeBase: number; boost: number } {
	const normalized = clampControlValue(volume, 'volume', 100);
	return normalized <= CONTROL_VALUE_LIMITS.volumeBase.max
		? { volumeBase: normalized, boost: 1 }
		: {
			volumeBase: CONTROL_VALUE_LIMITS.volumeBase.max,
			boost: normalized / CONTROL_VALUE_LIMITS.volumeBase.max,
		};
}

// The ACK projection of an audio volume is one shape, read by the canonical
// surface and by both narrow runtime entries (Content and UI). It is defined
// here, below all three, so a surface can no longer validate a shape the others
// do not: `audioVolume` is either exactly this projection or it is rejected.
export interface AudioVolumeProjectionShape {
	readonly effectiveVolume: number;
	readonly volumeState: 'silent' | 'native' | 'capture';
}

const audioVolumeProjectionKeys: ReadonlySet<string> =
	keySetOf<AudioVolumeProjectionShape>()(['effectiveVolume', 'volumeState']);

export function isAudioVolumeProjection(value: unknown): value is AudioVolumeProjectionShape {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	if (!Object.keys(record).every((key) => audioVolumeProjectionKeys.has(key))) return false;
	return isFiniteControlValue(record.effectiveVolume, 'volume')
		&& (record.volumeState === 'silent'
			|| record.volumeState === 'native'
			|| record.volumeState === 'capture');
}
