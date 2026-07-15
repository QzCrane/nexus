import { describe, expect, test } from 'bun:test';
import {
	initWebAudioHijack,
	setWebAudioEnhancementActive,
	updateVolume,
} from '../src/injector/webaudio-hijack';
import { FakeAudioContext, installFakeAudioWindow } from './helpers/fake-webaudio';

describe('WebAudio volume mode', () => {
	test('applies bounded gain, routes boosts through the limiter, and bypasses atomically', async () => {
		const environment = installFakeAudioWindow();
		setWebAudioEnhancementActive(false);
		updateVolume(1);
		const dispose = initWebAudioHijack();

		try {
			setWebAudioEnhancementActive(true);
			updateVolume(2.5);
			const context = new environment.window.AudioContext() as unknown as FakeAudioContext;
			const gain = context.gains[0]!;
			const limiter = context.compressors[0]!;
			expect(gain.gain.targets.at(-1)).toBe(2.5);
			expect(gain.connections).toEqual([limiter]);
			expect(limiter.connections).toEqual([context.rawDestination]);

			updateVolume(0.4);
			expect(gain.gain.targets.at(-1)).toBe(0.4);
			expect(gain.connections).toEqual([context.rawDestination]);
			expect(limiter.connections).toEqual([]);

			updateVolume(Number.NaN);
			expect(gain.gain.targets.at(-1)).toBe(1);
			updateVolume(100);
			expect(gain.gain.targets.at(-1)).toBe(8);
			expect(gain.connections).toEqual([limiter]);

			setWebAudioEnhancementActive(false);
			expect(gain.gain.targets.at(-1)).toBe(1);
			expect(gain.connections).toEqual([context.rawDestination]);
			await context.close();
		} finally {
			dispose();
			environment.restore();
		}
	});
});
