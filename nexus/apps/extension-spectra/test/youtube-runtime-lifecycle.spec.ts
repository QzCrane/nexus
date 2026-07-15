import { describe, expect, test } from 'bun:test';
import { YouTubeBridge } from '../src/content/logic/site-bridge/youtube-bridge';
import { initYouTubeAdapter } from '../src/injector/youtube-adapter';
import { Registry } from '../src/shared/registry';

type Listener = EventListenerOrEventListenerObject;
type PlayerListener = (...args: unknown[]) => void;

class FakeVideoElement {
	playbackRate = 2;
}

interface FakeYouTubeEnvironment {
	readonly window: Window;
	readonly video: FakeVideoElement;
	readonly playbackRateWrites: number[];
	readonly playerState: { value: number };
	dispatchWindowMessage(data: Record<string, unknown>): void;
	emitPlayer(type: string, ...args: unknown[]): void;
	windowListenerCount(type: string): number;
	playerListenerCount(type: string): number;
	restore(): void;
}

function invokeListener(listener: Listener, event: Event): void {
	if (typeof listener === 'function') listener(event);
	else listener.handleEvent(event);
}

function installYouTubeEnvironment(): FakeYouTubeEnvironment {
	const originalDescriptors = new Map<string, PropertyDescriptor | undefined>();
	const replaceGlobal = (name: string, value: unknown): void => {
		originalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
		Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
	};

	const windowListeners = new Map<string, Set<Listener>>();
	const playerListeners = new Map<string, Set<PlayerListener>>();
	const documentListeners = new Map<string, Set<Listener>>();
	const playbackRateWrites: number[] = [];
	const playerState = { value: 1 };
	const video = new FakeVideoElement();

	const fakeWindow = {
		location: { hostname: 'www.youtube.com' },
		addEventListener(type: string, listener: Listener) {
			let listeners = windowListeners.get(type);
			if (!listeners) {
				listeners = new Set();
				windowListeners.set(type, listeners);
			}
			listeners.add(listener);
		},
		removeEventListener(type: string, listener: Listener) {
			windowListeners.get(type)?.delete(listener);
		},
		postMessage() {
			// Tests assert page writes, not informational MAIN-to-content messages.
		},
	} as unknown as Window;

	const player = {
		addEventListener(type: string, listener: PlayerListener) {
			let listeners = playerListeners.get(type);
			if (!listeners) {
				listeners = new Set();
				playerListeners.set(type, listeners);
			}
			listeners.add(listener);
		},
		removeEventListener(type: string, listener: PlayerListener) {
			playerListeners.get(type)?.delete(listener);
		},
		setPlaybackRate(rate: number) {
			playbackRateWrites.push(rate);
			video.playbackRate = rate;
		},
		getPlaybackRate: () => video.playbackRate,
		setVolume() {},
		getVolume: () => 100,
		isMuted: () => false,
		mute() {},
		unMute() {},
		getPlayerState: () => playerState.value,
		getAdState: () => 0,
	};

	const fakeDocument = {
		querySelector(selector: string) {
			if (selector === '#movie_player') return player;
			return null;
		},
		getElementsByTagName(tagName: string) {
			return tagName === 'video' ? [video] : [];
		},
		addEventListener(type: string, listener: Listener) {
			let listeners = documentListeners.get(type);
			if (!listeners) {
				listeners = new Set();
				documentListeners.set(type, listeners);
			}
			listeners.add(listener);
		},
		removeEventListener(type: string, listener: Listener) {
			documentListeners.get(type)?.delete(listener);
		},
	} as unknown as Document;

	replaceGlobal('window', fakeWindow);
	replaceGlobal('document', fakeDocument);
	replaceGlobal('location', { hostname: 'www.youtube.com', origin: 'https://www.youtube.com' });
	replaceGlobal('HTMLVideoElement', FakeVideoElement);

	return {
		window: fakeWindow,
		video,
		playbackRateWrites,
		playerState,
		dispatchWindowMessage(data) {
			const event = { source: fakeWindow, data } as MessageEvent;
			for (const listener of [...(windowListeners.get('message') ?? [])]) {
				invokeListener(listener, event);
			}
		},
		emitPlayer(type, ...args) {
			for (const listener of [...(playerListeners.get(type) ?? [])]) listener(...args);
		},
		windowListenerCount: type => windowListeners.get(type)?.size ?? 0,
		playerListenerCount: type => playerListeners.get(type)?.size ?? 0,
		restore() {
			for (const [name, descriptor] of originalDescriptors) {
				if (descriptor) Object.defineProperty(globalThis, name, descriptor);
				else Reflect.deleteProperty(globalThis, name);
			}
		},
	};
}

describe('YouTube MAIN playback-rate ownership', () => {
	test('never writes native playback rate before an explicit SPECTRA target', () => {
		const environment = installYouTubeEnvironment();
		const dispose = initYouTubeAdapter();
		try {
			environment.playerState.value = 3;
			environment.emitPlayer('onPlaybackRateChange', 2);
			expect(environment.playbackRateWrites).toEqual([]);

			environment.dispatchWindowMessage({ type: 'SPECTRA_YT_SPEED', speed: 1.5 });
			expect(environment.playbackRateWrites).toEqual([1.5]);

			environment.emitPlayer('onPlaybackRateChange', 1);
			expect(environment.playbackRateWrites).toEqual([1.5, 1.5]);

			environment.dispatchWindowMessage({ type: 'SPECTRA_CLEAR_TARGET_SPEED' });
			expect(environment.playbackRateWrites).toEqual([1.5, 1.5, 2]);
			const writesAfterRelease = environment.playbackRateWrites.length;
			environment.emitPlayer('onPlaybackRateChange', 1);
			expect(environment.playbackRateWrites).toHaveLength(writesAfterRelease);
		} finally {
			dispose();
			environment.restore();
		}
	});

	test('restores the native baseline and removes enforcement on runtime disposal', () => {
		const environment = installYouTubeEnvironment();
		const dispose = initYouTubeAdapter();
		try {
			environment.dispatchWindowMessage({ type: 'SPECTRA_YT_SPEED', speed: 1.25 });
			expect(environment.video.playbackRate).toBe(1.25);
			dispose();
			expect(environment.video.playbackRate).toBe(2);
			expect(environment.playerListenerCount('onPlaybackRateChange')).toBe(0);
			const writesAfterDispose = environment.playbackRateWrites.length;
			environment.emitPlayer('onPlaybackRateChange', 1);
			expect(environment.playbackRateWrites).toHaveLength(writesAfterDispose);
		} finally {
			dispose();
			environment.restore();
		}
	});
});

describe('YouTube isolated-world bridge lifecycle', () => {
	test('uses one listener and lets the content Registry dispose it before reinjection', () => {
		const environment = installYouTubeEnvironment();
		try {
			const bridge = new YouTubeBridge();
			const firstUpdates: unknown[] = [];
			const secondUpdates: unknown[] = [];
			const registry = new Registry();
			const dispose = bridge.onInitialize({
				updateConfig: changes => { firstUpdates.push(changes); },
			});
			registry.track(dispose);
			const reboundDispose = bridge.onInitialize({
				updateConfig: changes => { secondUpdates.push(changes); },
			});

			expect(reboundDispose).toBe(dispose);
			expect(environment.windowListenerCount('message')).toBe(1);
			environment.dispatchWindowMessage({ type: 'SPECTRA_YT_SYNC_BACK', speed: 1.75 });
			expect(firstUpdates).toEqual([]);
			expect(secondUpdates).toEqual([{ speed: 1.75 }]);

			registry.dispose();
			expect(environment.windowListenerCount('message')).toBe(0);
			environment.dispatchWindowMessage({ type: 'SPECTRA_YT_SYNC_BACK', speed: 2 });
			expect(secondUpdates).toHaveLength(1);

			const nextRegistry = new Registry();
			nextRegistry.track(bridge.onInitialize({
				updateConfig: changes => { firstUpdates.push(changes); },
			}));
			expect(environment.windowListenerCount('message')).toBe(1);
			nextRegistry.dispose();
			expect(environment.windowListenerCount('message')).toBe(0);
		} finally {
			environment.restore();
		}
	});
});
