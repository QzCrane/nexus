import { describe, expect, test } from 'bun:test';
import { PolicyEngine, type PolicyContext } from '@nexus/audio-engine';
import { DEFAULT_AUDIO_CONFIG, type AudioConfig } from '@nexus/contracts';
import { shouldAcceptNativeConfigSync } from '../src/content/logic/mode-executor';

const BASE_CONTEXT: PolicyContext = {
	urlInfo: {
		fullUrl: 'https://media.example/watch',
		domain: 'media.example',
		pathname: '/watch',
		isIframe: false,
	},
	hasMediaElement: true,
	hasAudioContext: false,
	userInteracted: true,
	enabled: true,
	volume: 100,
	visualizerEnabled: false,
	forceNative: false,
	isRestricted: false,
	config: audioConfig(),
};

describe('audio policy activation boundary', () => {
	test('keeps the untouched default configuration fully disabled', () => {
		const policy = new PolicyEngine();
		expect(policy.calculateMode({
			...BASE_CONTEXT,
			config: audioConfig(),
		})).toBe('DISABLED');
	});

	test.each([
		['pan', { pan: 0.25 }],
		['delay', { delay: 120 }],
		['mono', { mono: true }],
	] as const)('routes %s processing through WebAudio', (_feature, changes) => {
		const config = audioConfig(changes);
		const policy = new PolicyEngine();
		expect(policy.calculateMode({
			...BASE_CONTEXT,
			volume: config.volume,
			config,
		})).toBe('NATIVE_WEBAUDIO');
	});

	test('does not import website-native state into an untouched default session', () => {
		expect(shouldAcceptNativeConfigSync(audioConfig(), false)).toBe(false);
		expect(shouldAcceptNativeConfigSync(audioConfig({ volume: 80 }), false)).toBe(true);
		expect(shouldAcceptNativeConfigSync(audioConfig(), true)).toBe(true);
	});
});

function audioConfig(changes: Partial<AudioConfig> = {}): AudioConfig {
	return {
		...DEFAULT_AUDIO_CONFIG,
		eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
		...changes,
	};
}
