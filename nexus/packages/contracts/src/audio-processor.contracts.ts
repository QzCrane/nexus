// goal: exact runtime contract for the admitted SPECTRA Capture processor graph

import { isFiniteControlValue } from './control-value-limits.js';
import { keySetOf } from './key-set.js';

// Playback speed, native page volume/mute and the product enable switch are
// intentionally outside this physical processor boundary.
export interface AudioProcessorConfig {
	// Processor gain is Boost only. Page volume and media mute remain owned by
	// the standard DOM/allowlisted official-player writers and cannot be encoded
	// as a second DSP writer at this boundary.
	boostGain: number;
	compressor: boolean;
	mono: boolean;
	bass: boolean;
	eqValues: number[];
	pan: number;
	delay: number;
}

const AUDIO_PROCESSOR_CONFIG_KEYS = keySetOf<AudioProcessorConfig>()([
	'boostGain',
	'compressor',
	'mono',
	'bass',
	'eqValues',
	'pan',
	'delay',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
	return Object.keys(value).every((key) => allowed.has(key));
}

export function isAudioProcessorConfig(value: unknown): value is AudioProcessorConfig {
	if (!isRecord(value) || !hasOnlyKeys(value, AUDIO_PROCESSOR_CONFIG_KEYS)) return false;
	return isFiniteControlValue(value.boostGain, 'boost')
		&& typeof value.compressor === 'boolean'
		&& typeof value.mono === 'boolean'
		&& typeof value.bass === 'boolean'
		&& Array.isArray(value.eqValues)
		&& value.eqValues.length === 10
		&& value.eqValues.every((item) => isFiniteControlValue(item, 'eqBand'))
		&& isFiniteControlValue(value.pan, 'pan')
		&& isFiniteControlValue(value.delay, 'delay');
}
