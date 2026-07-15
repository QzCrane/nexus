import { describe, expect, test } from 'bun:test';
import {
	initWebAudioHijack,
	setWebAudioEnhancementActive,
	updateVolume,
} from '../src/injector/webaudio-hijack';
import { FakeAudioContext, FakeGainNode, installFakeAudioWindow } from './helpers/fake-webaudio';

describe('MAIN WebAudio runtime', () => {
	test('is transparent by default and restores the page constructor on dispose', async () => {
		const environment = installFakeAudioWindow();
		setWebAudioEnhancementActive(false);
		updateVolume(1);
		const dispose = initWebAudioHijack();

		try {
			const Installed = environment.window.AudioContext;
			const untouched = new Installed() as unknown as FakeAudioContext;
			expect(untouched).toBeInstanceOf(FakeAudioContext);
			expect(untouched.gains).toHaveLength(0);
			expect(untouched.compressors).toHaveLength(0);
			expect(untouched.destination).toBe(untouched.rawDestination);

			setWebAudioEnhancementActive(true);
			const enhanced = new Installed() as unknown as FakeAudioContext;
			expect(enhanced.gains).toHaveLength(1);
			expect(enhanced.compressors).toHaveLength(1);
			expect(enhanced.destination).toBeInstanceOf(FakeGainNode);

			setWebAudioEnhancementActive(false);
			expect(enhanced.gains[0]?.gain.targets.at(-1)).toBe(1);
			expect(enhanced.gains[0]?.connections).toEqual([enhanced.rawDestination]);
			await enhanced.close();
		} finally {
			dispose();
			expect(environment.window.AudioContext).toBe(FakeAudioContext as unknown as typeof AudioContext);
			environment.restore();
		}
	});
});
