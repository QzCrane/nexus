// goal: prove the site-native control projection is a no-op without a control
//       and converges on the site's own level when one exists
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DEFAULT_AUDIO_CONFIG, isControlApplyAck, type AudioConfig, type ControlFieldStates, type ControlIntent, type MediaTarget } from '@nexus/contracts';
import type { MediaRegistry } from '../src/content/core/media-registry';
import { createAudioRuntimeControlDelegate } from '../src/content/logic/audio-runtime-control-delegate';
import { NativeMediaExecutor } from '../src/content/logic/native-media-executor';
import type { PolicyExecutor } from '../src/content/logic/policy-executor';
import type { PolicyExecutorState } from '../src/content/types';
import {
	projectSiteNativePlayback,
	projectSiteNativeVolume,
	readSiteNativeVolumeLevel,
} from '../src/content/logic/site-native-control-surface';

type FakeInput = { type: string; clientX: number; clientY: number; buttons: number };

class FakeMouseEvent {
	type: string;
	clientX = 0;
	clientY = 0;
	buttons = 0;
	constructor(type: string, init: Record<string, unknown>) {
		this.type = type;
		Object.assign(this, init);
	}
}

class FakeBar {
	width = 43.5;
	getBoundingClientRect(): { width: number; height: number } {
		return { width: this.width, height: 4 };
	}
	dispatchEvent(): boolean { return true; }
}

class FakeTrack {
	className = 'sound-progress';
	childElementCount = 1;
	bar = new FakeBar();
	level = 0.5;
	media: FakeMedia;
	dispatched: FakeInput[] = [];
	writesMirror = true;
	handleOffset = 0.02;
	constructor(media: FakeMedia) { this.media = media; }
	getBoundingClientRect(): Record<string, number> {
		return { x: 0, y: 0, left: 0, top: 0, width: 90, height: 12, right: 90, bottom: 12 };
	}
	querySelector(selector: string): unknown {
		return selector.includes('bar') ? this.bar : null;
	}
	querySelectorAll(selector: string): unknown[] {
		return selector.includes('bar') ? [this.bar] : [];
	}
	dispatchEvent(event: FakeInput): boolean {
		this.dispatched.push(event);
		// The player offsets the click by its handle radius and writes the level
		// to its own bar and to the media element's mirror.
		const ratio = Math.max(0, Math.min(1, event.clientX / 90));
		this.level = Math.max(0, Math.min(0.944, ratio - this.handleOffset));
		this.bar.width = this.level * 90;
		if (this.writesMirror) this.media.volume = this.level;
		return true;
	}
}

class FakePlayButton {
	media: FakeMedia;
	clicks = 0;
	get className(): string { return this.media.paused ? 'player-play-btn' : 'player-pause-btn'; }
	getAttribute(): string | null { return null; }
	constructor(media: FakeMedia) { this.media = media; }
	getBoundingClientRect(): Record<string, number> {
		return { x: 0, y: 0, left: 0, top: 0, width: 24, height: 24, right: 24, bottom: 24 };
	}
	dispatchEvent(event?: FakeInput | FakeMouseEvent): boolean {
		if (!event || event.type === 'click') {
			this.clicks += 1;
			this.media.paused = !this.media.paused;
		}
		return true;
	}
}

class FakeMedia extends EventTarget {
	private level = 0.5;
	get volume(): number { return this.level; }
	set volume(value: number) {
		if (this.level === value) return;
		this.level = value;
		queueMicrotask(() => this.dispatchEvent(new Event('volumechange')));
	}
	muted = false;
	paused = false;
	currentTime = 4;
	duration = 120;
	buffered = { length: 1 };
	playbackRate = 1;
	preservesPitch = true;
	parentElement: FakeContainer | null = null;
	play(): Promise<void> {
		this.paused = false;
		queueMicrotask(() => this.dispatchEvent(new Event('play')));
		return Promise.resolve();
	}
	pause(): void {
		this.paused = true;
		queueMicrotask(() => this.dispatchEvent(new Event('pause')));
	}
}

class FakeContainer {
	track: FakeTrack | null = null;
	playButton: FakePlayButton | null = null;
	querySelector(selector: string): unknown {
		if (selector.includes('sound-progress') || selector.includes('volume-progress')
			|| selector.includes('volume-track') || selector.includes('volume-slider')
			|| selector.includes('role="slider"')) return this.track;
		if (selector.includes('player-pause') || selector.includes('player-play')
			|| selector.includes('btn-pause') || selector.includes('btn-play')
			|| selector.includes('pause-btn') || selector.includes('play-btn')
			|| selector.includes('title*="暂停"') || selector.includes('title*="播放"')
			|| selector.includes('开始观看') || selector.includes('aria-label*="Pause"')
			|| selector.includes('aria-label*="Play"') || selector.includes('player-btn')) return this.playButton;
		return null;
	}
	querySelectorAll(selector: string): unknown[] {
		const found = this.querySelector(selector);
		return found ? [found] : [];
	}
}

function createOutputFixture() {
	install();
	Object.assign(globalThis, { HTMLMediaElement: FakeMedia, HTMLVideoElement: class extends FakeMedia {} });
	const media = new FakeMedia();
	const container = new FakeContainer();
	const track = new FakeTrack(media);
	// A slider without a handle offset gives an exact 70% readback.
	track.handleOffset = 0;
	track.writesMirror = false;
	container.track = track;
	container.playButton = new FakePlayButton(media);
	media.parentElement = container;
	const target: MediaTarget = {
		frameId: 0, documentId: 'document:site-output', mediaId: 'media:site-output', sourceRevision: 0, kind: 'audio',
	};
	const resolved = { target, element: media as unknown as HTMLMediaElement };
	const registry = {
		documentId: target.documentId, selectionRevision: 0,
		resolve: () => resolved, list: () => [resolved], subscribe: () => () => {},
	};
	const state: PolicyExecutorState = {
		config: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues], documentOutput: true },
		appliedConfig: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues], documentOutput: true },
		activeMode: 'capture', desiredMode: 'capture', actualMode: 'capture', phase: 'active',
		generation: 2, userHasInteracted: true, isPopupOpen: false,
	};
	const updateConfig = async (changes: Partial<AudioConfig>) => {
		state.config = { ...state.config, ...changes };
		state.appliedConfig = { ...state.config, eqValues: [...state.config.eqValues] };
		return { ok: true as const, data: { revision: 1 } };
	};
	const delegate = createAudioRuntimeControlDelegate({ updateConfig } as unknown as PolicyExecutor, state);
	const executor = new NativeMediaExecutor(registry as unknown as MediaRegistry);
	executor.setAudioRuntimeDelegate(delegate);
	const intent = (patch: ControlIntent['patch'], actualContext: ControlIntent['actualContext'] = {}): ControlIntent => ({
		intentId: 'intent:site-output', tabId: 7, documentId: target.documentId,
		generation: 2, baseRevision: 3, source: 'popup', requestedCoverage: 'full', target, actualContext, patch,
	});
	return { media, container, track, state, delegate, executor, intent };
}

const originals: Record<string, unknown> = {};
for (const key of ['document', 'MouseEvent', 'HTMLMediaElement', 'HTMLVideoElement']) {
	originals[key] = (globalThis as unknown as Record<string, unknown>)[key];
}

function install(): void {
	(globalThis as unknown as Record<string, unknown>).MouseEvent = FakeMouseEvent;
	(globalThis as unknown as Record<string, unknown>).document = {
		querySelector: () => null,
		querySelectorAll: () => [],
		dispatchEvent: () => true,
	};
}

afterEach(() => {
	for (const [key, value] of Object.entries(originals)) {
		(globalThis as unknown as Record<string, unknown>)[key] = value;
	}
});

describe('site-native control projection', () => {
	beforeEach(() => {
		(globalThis as unknown as Record<string, unknown>).document = undefined;
		(globalThis as unknown as Record<string, unknown>).MouseEvent = undefined;
	});

	test('is a complete no-op when the page exposes no native control', async () => {
		const media = new FakeMedia();
		media.parentElement = null;
		expect(await projectSiteNativePlayback(media as unknown as HTMLMediaElement, false)).toBe(false);
		expect(await projectSiteNativeVolume(media as unknown as HTMLMediaElement, 70)).toBeNull();
		expect(readSiteNativeVolumeLevel(media as unknown as HTMLMediaElement)).toBeNull();
	});

	test('does not throw when document has no querySelectorAll', async () => {
		const media = new FakeMedia();
		media.parentElement = new FakeContainer();
		install();
		(globalThis as unknown as Record<string, unknown>).document = {
			dispatchEvent: () => true,
		};
		expect(await projectSiteNativePlayback(media as unknown as HTMLMediaElement, false)).toBe(false);
	});

	test('clicks the site play/pause button instead of writing a vetoed DOM pause', async () => {
		const media = new FakeMedia();
		const container = new FakeContainer();
		container.playButton = new FakePlayButton(media);
		media.parentElement = container;
		install();
		expect(await projectSiteNativePlayback(media as unknown as HTMLMediaElement, false)).toBe(true);
		expect(media.paused).toBe(true);
		expect(container.playButton.clicks).toBe(1);
		// A second request for the same state must not click again.
		expect(await projectSiteNativePlayback(media as unknown as HTMLMediaElement, false)).toBe(true);
		expect(container.playButton.clicks).toBe(1);
	});

	test('ignores outer containers containing the media, zero-sized elements and tooltip/rotate controls', async () => {
		const media = new FakeMedia();
		const container = new FakeContainer();
		const outerWrapper = new FakePlayButton(media);
		(outerWrapper as unknown as { contains: (node: unknown) => boolean }).contains = (node) => node === media;
		container.playButton = outerWrapper;
		media.parentElement = container;
		install();
		// Contains media element -> skipped
		expect(await projectSiteNativePlayback(media as unknown as HTMLMediaElement, false)).toBe(false);

		// Zero size -> skipped
		const zeroSize = new FakePlayButton(media);
		zeroSize.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 });
		container.playButton = zeroSize;
		expect(await projectSiteNativePlayback(media as unknown as HTMLMediaElement, false)).toBe(false);

		// Rotate / tooltip control -> skipped
		const tooltipButton = new FakePlayButton(media);
		Object.defineProperty(tooltipButton, 'className', { get: () => 'player-play-btn rotate-button' });
		container.playButton = tooltipButton;
		expect(await projectSiteNativePlayback(media as unknown as HTMLMediaElement, false)).toBe(false);
	});

	test('calibrates the site slider to the requested level and aligns the element mirror', async () => {
		const media = new FakeMedia();
		const container = new FakeContainer();
		container.track = new FakeTrack(media);
		media.parentElement = container;
		install();
		const level = await projectSiteNativeVolume(media as unknown as HTMLMediaElement, 70);
		expect(level).not.toBeNull();
		expect(level ?? 0).toBeGreaterThanOrEqual(68);
		expect(level ?? 0).toBeLessThanOrEqual(70);
		expect(media.volume).toBeCloseTo((level ?? 70) / 100, 2);
		expect(container.track.bar.width).toBeCloseTo((level ?? 70) * 0.9, 0);
		expect(readSiteNativeVolumeLevel(media as unknown as HTMLMediaElement)).toBe(level);
		// Each pass drives the site's own control, never the DOM property first.
		expect(container.track.dispatched.length).toBeGreaterThan(0);
	});

	test('does not drive an unrelated timeline slider', async () => {
		const { executor, media, track } = createOutputFixture();
		try {
			track.className = 'timeline';
			expect(await projectSiteNativeVolume(media as unknown as HTMLMediaElement, 70)).toBeNull();
			expect(track.dispatched).toHaveLength(0);
		} finally { executor.dispose(); }
	});

	test('a zero site level is not replaced by the stale DOM mirror', () => {
		const { executor, media, track } = createOutputFixture();
		try {
			track.bar.width = 0;
			expect(media.volume).toBe(0.5);
			expect(readSiteNativeVolumeLevel(media as unknown as HTMLMediaElement)).toBe(0);
		} finally { executor.dispose(); }
	});

	test('a site readback failure cannot fall through to a successful DOM-only write', async () => {
		const { executor, media, track, state, intent } = createOutputFixture();
		state.config.documentOutput = undefined;
		state.appliedConfig.documentOutput = undefined;
		state.actualMode = 'native';
		track.dispatchEvent = event => { track.dispatched.push(event); return true; };
		try {
			const request = intent({ volumeBase: 70 });
			request.requestedCoverage = 'active-target';
			const ack = await executor.execute(request);
			expect(ack.fields.volumeBase).toMatchObject({ phase: 'error', controlled: false,
				lastError: { code: 'readback-mismatch' } });
			expect(media.volume).toBe(0.5);
		} finally { executor.dispose(); }
	});

	test('a selection change during calibration stops further site inputs', async () => {
		const { executor, media, track } = createOutputFixture();
		track.handleOffset = 0.1;
		let current = true;
		try {
			const operation = projectSiteNativeVolume(media as unknown as HTMLMediaElement, 70,
				{ isCurrent: () => current });
			const inputs = track.dispatched.length;
			expect(inputs).toBeGreaterThan(0);
			current = false;
			await expect(operation).rejects.toMatchObject({ code: 'stale-media-source' });
			expect(track.dispatched).toHaveLength(inputs);
			expect(media.volume).toBe(0.5);
		} finally { executor.dispose(); }
	});

	test('keeps site volume 70 through pause, resume and mute without replacing processor unity', async () => {
		const { executor, delegate, state, media, track, intent } = createOutputFixture();
		try {
			delegate.setSiteNativeLevel?.(50);
			const ack = await executor.execute(intent({ volumeBase: 70 }, { volumeBase: 50 }));
			expect(isControlApplyAck(ack)).toBe(true);
			expect(ack.fields.volumeBase).toMatchObject({ desired: 70, actual: 70, phase: 'applied',
				controlled: true, strategy: 'capture', coverage: 'opaque', lastError: null });
			expect(media.volume).toBe(0.7);
			expect(track.dispatched.length).toBeGreaterThan(0);
			expect(delegate.read(['volumeBase']).patch.volumeBase).toBe(70);
			const trackInputs = track.dispatched.length;
			for (const patch of [{ playing: false }, { playing: true }, { mediaMuted: true }, { mediaMuted: false }]) {
				const request = intent(patch);
				if (patch.playing !== undefined) request.requestedCoverage = 'active-target';
				const next = await executor.execute(request);
				expect(isControlApplyAck(next)).toBe(true);
				if (patch.playing !== undefined) {
					expect(next.fields.playing).toMatchObject({ actual: patch.playing, phase: 'applied' });
					expect(media.paused).toBe(!patch.playing);
				} else {
					expect(next.fields.mediaMuted).toMatchObject({ actual: patch.mediaMuted, phase: 'applied' });
				}
				expect(executor.read({ target: null, fields: ['volumeBase'] })).toMatchObject({
					patch: { volumeBase: 70 }, observedStrategies: { volumeBase: 'capture' },
				});
				expect(state.appliedConfig.volumeBase).toBe(100);
				expect(track.dispatched.length).toBe(trackInputs);
			}
		} finally { executor.dispose(); }
	});

	test.each([70, 100])('calibrates a native blob player before acknowledging volume %s without Capture', async (volume) => {
		const { executor, media, track, state, intent } = createOutputFixture();
		state.config.documentOutput = undefined;
		state.appliedConfig.documentOutput = undefined;
		state.actualMode = 'native';
		const processorBefore = structuredClone(state.appliedConfig);
		try {
			const request = intent({ volumeBase: volume });
			request.requestedCoverage = 'active-target';
			const ack = await executor.execute(request);
			const actual = volume === 100 ? 94 : volume;
			expect(ack.fields.volumeBase).toMatchObject({ actual, phase: 'applied',
				controlled: true, strategy: 'dom-native', coverage: 'active-target', lastError: null });
			expect(ack.fields.volumeBase?.writeState).not.toBe('written');
			expect(media.volume).toBe(actual / 100);
			expect(Math.round(track.bar.width / 90 * 100)).toBe(actual);
			expect(track.dispatched.length).toBeGreaterThan(0);
			expect(state.appliedConfig.documentOutput).toBeUndefined();
			expect(state.appliedConfig.boost).toBe(processorBefore.boost);
		} finally { executor.dispose(); }
	});

	test('disposal during site calibration prevents mirror writes and processor acknowledgement', async () => {
		const { executor, media, track, state, intent } = createOutputFixture();
		track.handleOffset = 0.1;
		const operation = executor.execute(intent({ volumeBase: 70 }));
		expect(track.dispatched.length).toBeGreaterThan(0);
		const inputs = track.dispatched.length;
		const applied = structuredClone(state.appliedConfig);
		executor.dispose();
		await expect(operation).rejects.toMatchObject({ code: 'cancelled' });
		expect(track.dispatched).toHaveLength(inputs);
		expect(media.volume).toBe(0.5);
		expect(state.appliedConfig).toEqual(applied);
	});

	test('clears the site witness when an explicit volume request returns to processor-owned output', async () => {
		const { executor, delegate, container, state, intent } = createOutputFixture();
		try {
			await executor.execute(intent({ volumeBase: 70 }));
			expect(delegate.read(['volumeBase']).patch.volumeBase).toBe(70);
			container.track = null;
			const ack = await executor.execute(intent({ volumeBase: 40 }, { volumeBase: 70 }));
			expect(isControlApplyAck(ack)).toBe(true);
			expect(ack.fields.volumeBase).toMatchObject({ actual: 40, phase: 'applied', strategy: 'capture' });
			expect(state.appliedConfig.volumeBase).toBe(40);
			expect(executor.read({ target: null, fields: ['volumeBase'] }).patch.volumeBase).toBe(40);
		} finally { executor.dispose(); }
	});

	test.each(['processor-error', 'coverage-error', 'idle', 'uncontrolled', 'non-unity', 'last-error', 'missing'] as const)(
		'never turns a site slider write into processor success (%s)', async (outcome) => {
			const { executor, delegate, state, media, intent } = createOutputFixture();
			const apply = delegate.apply;
			let processorState: ControlFieldStates['volumeBase'];
			delegate.apply = async (...args) => {
				// Use the real delegate's coverage rejection as well as adversarial ACKs
				// to check every part of the success predicate independently.
				const fields = await apply(...args);
				const volume = fields.volumeBase;
				if (!volume) throw new Error('Expected the processor volume result');
				if (outcome === 'processor-error' || outcome === 'last-error') {
					volume.lastError = { code: 'readback-mismatch', message: 'Processor unity was not confirmed', retryable: true };
					if (outcome === 'processor-error') {
						volume.phase = 'error';
						volume.controlled = false;
					}
				}
				if (outcome === 'idle') volume.phase = 'idle';
				if (outcome === 'uncontrolled') volume.controlled = false;
				if (outcome === 'non-unity') volume.actual = 99;
				if (outcome === 'missing') delete fields.volumeBase;
				processorState = structuredClone(fields.volumeBase);
				return fields;
			};
			if (outcome === 'coverage-error') state.mediaRoute = 'direct';
			try {
				const ack = await executor.execute(intent({ volumeBase: 70 }));
				expect(media.volume).toBe(0.7);
				expect(ack.fields.volumeBase).toEqual(processorState);
				expect(isControlApplyAck(ack)).toBe(true);
				if (outcome === 'coverage-error') expect(ack.fields.volumeBase).toMatchObject({
					phase: 'error', actual: null, strategy: 'unsupported', coverage: 'partial', controlled: false,
					lastError: { code: 'capability-unavailable' },
				});
			} finally { executor.dispose(); }
		},
	);

	test('leaves the DOM mirror to the single canonical media writer', async () => {
		const media = new FakeMedia();
		const container = new FakeContainer();
		const track = new FakeTrack(media);
		track.writesMirror = false;
		container.track = track;
		media.parentElement = container;
		install();
		const level = await projectSiteNativeVolume(media as unknown as HTMLMediaElement, 70);
		expect(level ?? 0).toBeGreaterThanOrEqual(68);
		expect(track.bar.width).toBeGreaterThan(60);
		// A paused player may move its bar without refreshing the mirror. The
		// projection must not become a second volume writer to compensate.
		expect(media.volume).toBe(0.5);
	});

	test('distinguishes play and pause buttons when resuming and pausing', async () => {
		const media = new FakeMedia();
		const container = new FakeContainer();
		const playBtn = new FakePlayButton(media);
		const pauseBtn = new FakePlayButton(media);
		Object.defineProperty(playBtn, 'className', { get: () => 'player-play-btn' });
		Object.defineProperty(pauseBtn, 'className', { get: () => 'player-pause-btn' });
		container.querySelector = (selector: string) => {
			if (selector.includes('player-play') || selector.includes('btn-play') || selector.includes('play-btn')) return playBtn;
			if (selector.includes('player-pause') || selector.includes('btn-pause') || selector.includes('pause-btn')) return pauseBtn;
			return null;
		};
		container.querySelectorAll = (selector: string) => {
			const found = container.querySelector(selector);
			return found ? [found] : [];
		};
		media.parentElement = container;
		install();

		// Currently playing: request pause
		media.paused = false;
		expect(await projectSiteNativePlayback(media as unknown as HTMLMediaElement, false)).toBe(true);
		expect(media.paused).toBe(true);
		expect(pauseBtn.clicks).toBe(1);
		expect(playBtn.clicks).toBe(0);

		// Currently paused: request resume play
		expect(await projectSiteNativePlayback(media as unknown as HTMLMediaElement, true)).toBe(true);
		expect(media.paused).toBe(false);
		expect(playBtn.clicks).toBe(1);
		expect(pauseBtn.clicks).toBe(1);
	});

	test('supports vertical volume tracks and projects vertical inputs', async () => {
		const media = new FakeMedia();
		const container = new FakeContainer();
		const verticalTrack = new FakeTrack(media);
		verticalTrack.getBoundingClientRect = () => ({
			x: 0, y: 0, left: 0, top: 0, width: 12, height: 100, right: 12, bottom: 100,
		});
		verticalTrack.bar.getBoundingClientRect = () => ({
			width: 12, height: verticalTrack.level * 100,
		});
		verticalTrack.dispatchEvent = (event: FakeInput) => {
			verticalTrack.dispatched.push(event);
			const ratio = Math.max(0, Math.min(1, (100 - event.clientY) / 100));
			verticalTrack.level = ratio;
			verticalTrack.bar.width = 12;
			return true;
		};
		container.track = verticalTrack;
		media.parentElement = container;
		install();

		verticalTrack.level = 0.7;
		expect(readSiteNativeVolumeLevel(media as unknown as HTMLMediaElement)).toBe(70);

		const level = await projectSiteNativeVolume(media as unknown as HTMLMediaElement, 40);
		expect(level).toBe(40);
		expect(verticalTrack.dispatched.length).toBeGreaterThan(0);
	});

	test('falls back to media volume mirror when site volume track is collapsed to prevent false zero collapse', () => {
		const media = new FakeMedia();
		media.volume = 0.75;
		media.muted = false;
		const container = new FakeContainer();
		const track = new FakeTrack(media);
		// Simulate collapsed popup bar
		track.bar.width = 0;
		(track as unknown as { offsetParent: null }).offsetParent = null;
		container.track = track;
		media.parentElement = container;
		install();

		// Should not read 0, but fallback to 75 from media.volume
		expect(readSiteNativeVolumeLevel(media as unknown as HTMLMediaElement)).toBe(75);
	});
});
