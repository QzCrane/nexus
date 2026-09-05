import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_AUDIO_CONFIG,
	requiresAudioProcessor,
	resolveDesiredAudioMode,
	type AudioConfig,
} from '@nexus/contracts';

function config(changes: Partial<AudioConfig> = {}): AudioConfig {
	return {
		...DEFAULT_AUDIO_CONFIG,
		eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
		...changes,
	};
}

describe('canonical three-owner audio processor policy', () => {
	test('keeps default and native attenuation on bypass', () => {
		expect(requiresAudioProcessor(config())).toBe(false);
		expect(resolveDesiredAudioMode(config())).toBe('bypass');
		expect(resolveDesiredAudioMode(config({
			volume: 40,
			volumeBase: 40,
			boost: 1,
		}))).toBe('bypass');
	});

	test.each([0, 40, 100])(
		'admits a real processor at native volume %i only for an explicit foreground visualizer demand',
		(nativeVolumeValue) => {
			const nativeVolume = config({
				volume: nativeVolumeValue,
				volumeBase: nativeVolumeValue,
				boost: 1,
			});
			expect(requiresAudioProcessor(nativeVolume)).toBe(false);
				expect(resolveDesiredAudioMode(nativeVolume, {
					visualizer: true,
					mediaWebAudio: true,
				})).toBe('webaudio');
				expect(resolveDesiredAudioMode(nativeVolume, {
					visualizer: true,
					mediaWebAudio: false,
				})).toBe('capture');
				expect(resolveDesiredAudioMode(
					{ ...nativeVolume, enabled: false },
					{ visualizer: true, mediaWebAudio: true },
				)).toBe('bypass');
		},
	);

	test.each([
		['boost', { boost: 1.5, volume: 150 }],
		['eq', { eqValues: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0] }],
		['bass', { bass: true }],
		['compressor', { compressor: true }],
		['mono', { mono: true }],
		['pan', { pan: -0.25 }],
		['delay', { delay: 80 }],
	] satisfies Array<[string, Partial<AudioConfig>]>)('%s chooses the least invasive proven processor', (_field, changes) => {
		const candidate = config(changes);
		expect(requiresAudioProcessor(candidate)).toBe(true);
		expect(resolveDesiredAudioMode(candidate)).toBe('capture');
		expect(resolveDesiredAudioMode(candidate, {
			visualizer: false,
			mediaWebAudio: true,
		})).toBe('webaudio');
	});

	test('honors one explicit site route without treating it as Capture admission', () => {
		const candidate = config({ boost: 1.5, volume: 150 });
		expect(resolveDesiredAudioMode(candidate, {
			visualizer: false,
			mediaWebAudio: false,
			mediaRoute: 'auto',
		})).toBe('capture');
		expect(resolveDesiredAudioMode(candidate, {
			visualizer: false,
			mediaWebAudio: false,
			mediaRoute: 'direct',
		})).toBe('webaudio');
		expect(resolveDesiredAudioMode(candidate, {
			visualizer: false,
			mediaWebAudio: true,
			mediaRoute: 'capture',
		})).toBe('capture');
	});

	test('the master switch cannot leave a processor desired', () => {
		const disabled = config({ enabled: false, boost: 2, volume: 200, bass: true });
		expect(requiresAudioProcessor(disabled)).toBe(true);
		expect(resolveDesiredAudioMode(disabled)).toBe('bypass');
	});
});
