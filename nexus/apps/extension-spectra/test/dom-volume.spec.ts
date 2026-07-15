import { describe, expect, mock, test } from 'bun:test';
import {
	enableVolumeLock,
	registerDomMedia,
	releaseVolumeLock,
} from '../src/content/audio/dom-volume';
import { setupVolumeMonitor } from '../src/content/audio/volume-observer';

interface FakeMediaElement {
	volume: number;
	muted: boolean;
	playbackRate: number;
	addEventListener: (_type: string, _listener: EventListener) => void;
	removeEventListener: (_type: string, _listener: EventListener) => void;
}

describe('DOM volume ownership', () => {
	test('treats unowned website volume and speed as baselines, not SPECTRA config', () => {
		const requestAnimationFrameDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
		const cancelAnimationFrameDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');
		Object.defineProperty(globalThis, 'requestAnimationFrame', {
			configurable: true,
			value: (callback: FrameRequestCallback) => {
				callback(0);
				return 1;
			},
		});
		Object.defineProperty(globalThis, 'cancelAnimationFrame', {
			configurable: true,
			value: () => undefined,
		});
		const media = Object.assign(new EventTarget(), {
			volume: 0.4,
			muted: false,
			playbackRate: 1,
		});
		const onNativeVolumeChange = mock(() => undefined);
		const onNativeSpeedChange = mock(() => undefined);
		const dispose = setupVolumeMonitor(media as unknown as HTMLMediaElement, {
			getTargetVolume: () => 1,
			getTargetMuted: () => false,
			getUserInteracted: () => false,
			isSyncEnabled: () => false,
			onNativeVolumeChange,
			onNativeSpeedChange,
		});

		try {
			expect(onNativeVolumeChange).not.toHaveBeenCalled();
			media.volume = 0.7;
			media.dispatchEvent(new Event('volumechange'));
			media.playbackRate = 1.5;
			media.dispatchEvent(new Event('ratechange'));
			expect(onNativeVolumeChange).not.toHaveBeenCalled();
			expect(onNativeSpeedChange).not.toHaveBeenCalled();
		} finally {
			dispose();
			restoreProperty('requestAnimationFrame', requestAnimationFrameDescriptor);
			restoreProperty('cancelAnimationFrame', cancelAnimationFrameDescriptor);
		}
	});

	test('captures the first baseline, restores it on release, and leaves unowned media untouched', () => {
		const owned = fakeMedia(0.37, true);
		const untouched = fakeMedia(0.64, false);
		const disposeUntouched = registerDomMedia(untouched as unknown as HTMLMediaElement);
		let disposeOwned = () => undefined;

		try {
			releaseVolumeLock();
			expect(untouched.volume).toBe(0.64);
			expect(untouched.muted).toBe(false);

			disposeOwned = registerDomMedia(owned as unknown as HTMLMediaElement);
			enableVolumeLock(0.8, false);
			expect(owned.volume).toBe(0.8);
			expect(owned.muted).toBe(false);
			enableVolumeLock(0.55, false);
			expect(owned.volume).toBe(0.55);

			releaseVolumeLock();
			expect(owned.volume).toBe(0.37);
			expect(owned.muted).toBe(true);

			releaseVolumeLock();
			expect(untouched.volume).toBe(0.64);
			expect(untouched.muted).toBe(false);
		} finally {
			releaseVolumeLock();
			disposeOwned();
			disposeUntouched();
		}
	});
});

function restoreProperty(key: 'requestAnimationFrame' | 'cancelAnimationFrame', descriptor?: PropertyDescriptor): void {
	if (descriptor) Object.defineProperty(globalThis, key, descriptor);
	else Reflect.deleteProperty(globalThis, key);
}

function fakeMedia(volume: number, muted: boolean): FakeMediaElement {
	return {
		volume,
		muted,
		playbackRate: 1,
		addEventListener: () => undefined,
		removeEventListener: () => undefined,
	};
}
