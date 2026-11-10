// goal: exact runtime contract for the admitted SPECTRA Capture processor graph

import { CONTROL_VALUE_LIMITS, isFiniteControlValue } from './control-value-limits.js';
import { keySetOf } from './key-set.js';

// Playback speed, native page volume/mute and the product enable switch remain
// outside this boundary. An explicitly admitted document-output owner has its
// own level; it never interprets an element's native properties as output gain.
export interface AudioProcessorConfig {
	// The legacy processor owns Boost only. The document-output owner explicitly
	// replaces that contribution; native element volume/mute are never copied in.
	boostGain: number;
	// Presence names a separately admitted full-document output owner. Mute has
	// its own physical gate, so muting never destroys the retained numeric gain.
	outputLevel?: { gain: number; muted: boolean };
	compressor: boolean;
	mono: boolean;
	bass: boolean;
	eqValues: number[];
	pan: number;
	delay: number;
}

const AUDIO_PROCESSOR_CONFIG_KEYS = keySetOf<AudioProcessorConfig>()([
	'boostGain',
	'outputLevel',
	'compressor',
	'mono',
	'bass',
	'eqValues',
	'pan',
	'delay',
]);
const OUTPUT_LEVEL_KEYS = keySetOf<NonNullable<AudioProcessorConfig['outputLevel']>>()(['gain', 'muted']);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
	return Object.keys(value).every((key) => allowed.has(key));
}

export function isAudioProcessorConfig(value: unknown): value is AudioProcessorConfig {
	if (!isRecord(value) || !hasOnlyKeys(value, AUDIO_PROCESSOR_CONFIG_KEYS)) return false;
	return isFiniteControlValue(value.boostGain, 'boost')
		&& (value.outputLevel === undefined || isRecord(value.outputLevel)
			&& hasOnlyKeys(value.outputLevel, OUTPUT_LEVEL_KEYS)
			&& typeof value.outputLevel.gain === 'number'
			&& Number.isFinite(value.outputLevel.gain)
			&& value.outputLevel.gain >= 0
			&& value.outputLevel.gain <= CONTROL_VALUE_LIMITS.boost.max
			&& typeof value.outputLevel.muted === 'boolean')
		&& typeof value.compressor === 'boolean'
		&& typeof value.mono === 'boolean'
		&& typeof value.bass === 'boolean'
		&& Array.isArray(value.eqValues)
		&& value.eqValues.length === 10
		&& value.eqValues.every((item) => isFiniteControlValue(item, 'eqBand'))
		&& isFiniteControlValue(value.pan, 'pan')
		&& isFiniteControlValue(value.delay, 'delay');
}
