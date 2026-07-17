import { describe, expect, test } from 'bun:test';
import { PolicyEngine, type PolicyContext } from '@nexus/audio-engine';
import { DEFAULT_AUDIO_CONFIG, type AudioConfig } from '@nexus/contracts';
import { evaluateMediaSourceEligibility } from '../src/content/logic/policy-executor';

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

	test('requires every registered source to be prospectively safe for Media WebAudio', () => {
		const descriptors = new Map([
			['document', Object.getOwnPropertyDescriptor(globalThis, 'document')],
			['location', Object.getOwnPropertyDescriptor(globalThis, 'location')],
		] as const);
		Object.defineProperty(globalThis, 'document', {
			configurable: true,
			value: { baseURI: 'https://media.example/watch' },
		});
		Object.defineProperty(globalThis, 'location', {
			configurable: true,
			value: { href: 'https://media.example/watch', origin: 'https://media.example' },
		});
		try {
			const safe = { currentSrc: 'https://media.example/a.mp3', src: '' } as HTMLMediaElement;
			const safeSecond = { currentSrc: 'https://media.example/b.mp3', src: '' } as HTMLMediaElement;
			const pending = { currentSrc: '', src: '' } as HTMLMediaElement;
			const unsafe = { currentSrc: 'https://cdn.example/c.mp3', src: '' } as HTMLMediaElement;
			expect(evaluateMediaSourceEligibility([safe, safeSecond])).toBe('SAFE');
			expect(evaluateMediaSourceEligibility([safe, pending])).toBe('PENDING');
			expect(evaluateMediaSourceEligibility([safe, unsafe])).toBe('RESTRICTED');
			expect(evaluateMediaSourceEligibility([safe], () => true)).toBe('RESTRICTED');
		} finally {
			for (const [key, descriptor] of descriptors) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor);
				else Reflect.deleteProperty(globalThis, key);
			}
		}
	});
});

function audioConfig(changes: Partial<AudioConfig> = {}): AudioConfig {
	return {
		...DEFAULT_AUDIO_CONFIG,
		eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
		...changes,
	};
}
