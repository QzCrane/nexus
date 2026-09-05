import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import {
	audioConfigToProcessorConfig,
	compileEffectiveVolume,
	DEFAULT_AUDIO_CONFIG,
	splitEffectiveVolume,
	type AudioConfig,
} from '@nexus/contracts';
import {
	describeAudioHost,
	destroyAudioHost,
	handleAudioHostMessage,
} from '../src/offscreen/audio-host';
import { AudioGraphRouter } from '@nexus/audio-engine';
import { requireValue } from './helpers/require-value';

const DEFAULT_CONFIG: AudioConfig = {
	...DEFAULT_AUDIO_CONFIG,
	eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
};

let audioHarness: AudioHarness;

describe('offscreen audio host', () => {
	beforeEach(async () => {
		await destroyAudioHost();
		audioHarness = installAudioHarness();
	});

	afterEach(async () => {
		await destroyAudioHost();
		audioHarness.restore();
	});

	test('acknowledges capture only after a transparent graph exists and ignores stale generations', async () => {
		const started = await start(7, 4, DEFAULT_CONFIG);
		expectActive(started, 7, 4, 1);
		expectHost(7, 4, 1, { boostGain: 1 });
		expect(audioHarness.getUserMediaCalls).toHaveLength(1);
		expect(audioHarness.contexts).toHaveLength(1);

		const firstContext = requireValue(
			audioHarness.contexts[0],
			'Expected the first capture to create an audio context',
		);
		const firstStream = requireValue(
			audioHarness.streams[0],
			'Expected the first capture to create a media stream',
		);
		expect(firstContext.resumeCalls).toBe(1);
		expect(firstContext.compressors).toHaveLength(0);
		expect(firstContext.delays).toHaveLength(0);
		expect(firstContext.analysers).toHaveLength(0);

		const sameGeneration = await start(7, 4, config({
			volume: 250,
			compressor: true,
			pan: 2,
			delay: -80,
		}), 2);
		expectActive(sameGeneration, 7, 4, 2);
		expect(audioHarness.getUserMediaCalls).toHaveLength(1);
		expect(audioHarness.contexts).toHaveLength(1);
		expect(sameGeneration).toMatchObject({
			normalizedActualConfig: { boostGain: 2.5, pan: 1, delay: 0, compressor: true },
		});
		expect(firstContext.compressors).toHaveLength(1);
		const firstPanner = requireValue(
			firstContext.panners[0],
			'Expected the updated graph to contain a stereo panner',
		);
		expect(firstPanner.pan.value).toBe(1);
		expect(firstContext.delays).toHaveLength(0);

		const gainCreationsBeforeStaleUpdate = firstContext.gains.length;
		const staleUpdate = await handleAudioHostMessage({
			type: 'OFFSCREEN_AUDIO_UPDATE',
			tabId: 7,
			generation: 3,
			controlRevision: 1,
			config: audioConfigToProcessorConfig(config({ volume: 700 })),
		});
		expectActive(staleUpdate, 7, 4, 2);
		expect(firstContext.gains).toHaveLength(gainCreationsBeforeStaleUpdate);

		const staleStop = await handleAudioHostMessage({
			type: 'OFFSCREEN_AUDIO_STOP',
			tabId: 7,
			generation: 3,
		});
		expectActive(staleStop, 7, 4, 2);
		expect(firstStream.track.stopCalls).toBe(0);
		expect(firstContext.closeCalls).toBe(0);

		const newerStart = await start(7, 5, DEFAULT_CONFIG, 3);
		expectActive(newerStart, 7, 5, 3);
		expect(firstStream.track.stopCalls).toBe(1);
		expect(firstContext.closeCalls).toBe(1);
		expect(audioHarness.contexts).toHaveLength(2);
		expectHost(7, 5, 3, { boostGain: 1 });

		const stopped = await handleAudioHostMessage({
			type: 'OFFSCREEN_AUDIO_STOP',
			tabId: 7,
			generation: 5,
		});
		expectIdle(stopped, 7, 5, 3);
		expect(describeAudioHost()).toEqual([]);
	});

	test('returns a structured retryable failure without publishing an active processor', async () => {
		audioHarness.getUserMediaError = new Error('capture permission denied');

		const result = await start(12, 2, DEFAULT_CONFIG);

		expect(result).toEqual({
			ok: false,
			tabId: 12,
			generation: 2,
			controlRevision: 1,
			error: {
				code: 'capture_start_failed',
				message: 'capture permission denied',
				retryable: true,
			},
		});
		expect(describeAudioHost()).toEqual([]);
		expect(audioHarness.contexts).toHaveLength(0);
	});

	test('rejects a capture stream without a live audio track before publishing a processor', async () => {
		audioHarness.nextStreamHasAudio = false;

		const result = await start(11, 3, DEFAULT_CONFIG);

		expect(result).toMatchObject({
			ok: false,
			tabId: 11,
			generation: 3,
			error: {
				code: 'capture_start_failed',
				message: 'Tab capture returned no live audio track',
				retryable: true,
			},
		});
		expect(describeAudioHost()).toEqual([]);
		expect(audioHarness.contexts).toHaveLength(0);
		expect(audioHarness.streams[0]?.track.stopCalls).toBe(1);
	});

	test('keeps the acknowledged processor when a newer replacement cannot be created', async () => {
		await start(13, 4, DEFAULT_CONFIG);
		const originalContext = requireValue(
			audioHarness.contexts[0],
			'Expected the original capture to create an audio context',
		);
		const originalStream = requireValue(
			audioHarness.streams[0],
			'Expected the original capture to create a media stream',
		);
		audioHarness.getUserMediaError = new Error('replacement denied');

		const result = await start(13, 5, config({ volume: 240 }));

		expect(result).toEqual({
			ok: false,
			tabId: 13,
			generation: 5,
			controlRevision: 1,
			error: { code: 'capture_start_failed', message: 'replacement denied', retryable: true },
		});
		expectHost(13, 4, 1, { boostGain: 1 });
		expect(originalStream.track.stopCalls).toBe(0);
		expect(originalContext.closeCalls).toBe(0);
	});

	test('switches replacement capture gates at one boundary without a full-gain overlap', async () => {
		await start(19, 1, DEFAULT_CONFIG);
		const originalContext = requireValue(
			audioHarness.contexts[0],
			'Expected the original capture to create an audio context',
		);
		await start(19, 2, config({ volume: 240 }), 2);
		const replacementContext = requireValue(
			audioHarness.contexts[1],
			'Expected replacement capture to create a second audio context',
		);
		const originalGate = requireValue(
			originalContext.gains[0],
			'Expected the original graph to expose its capture gate',
		).gain;
		const replacementGate = requireValue(
			replacementContext.gains[0],
			'Expected the replacement graph to expose its capture gate',
		).gain;
		const switchDown = originalGate.writes.find((write) => (
			write.value === 0 && write.startTime > originalContext.currentTime
		));
		const switchUp = replacementGate.writes.find((write) => (
			write.value === 1 && write.startTime > replacementContext.currentTime
		));

		expect(switchDown).toBeDefined();
		expect(switchUp).toBeDefined();
		expect(switchDown?.startTime).toBe(switchUp?.startTime);
	});

	test('advances processor generation only on an acknowledged config update', async () => {
		await start(14, 2, DEFAULT_CONFIG);
		const updated = await handleAudioHostMessage({
			type: 'OFFSCREEN_AUDIO_UPDATE',
			tabId: 14,
			generation: 3,
			controlRevision: 2,
			config: audioConfigToProcessorConfig(config({ volume: 160 })),
		});

		expectActive(updated, 14, 3, 2);
		expectHost(14, 3, 2, { boostGain: 1.6 });
		const staleStop = await handleAudioHostMessage({
			type: 'OFFSCREEN_AUDIO_STOP',
			tabId: 14,
			generation: 2,
		});
		expectActive(staleStop, 14, 3, 2);
	});

	test('does not let an older concurrent UPDATE regress a newer committed generation', async () => {
		await start(23, 1, DEFAULT_CONFIG);
		const newer = handleAudioHostMessage({
			type: 'OFFSCREEN_AUDIO_UPDATE',
			tabId: 23,
			generation: 3,
			controlRevision: 3,
			config: audioConfigToProcessorConfig(config({ volume: 160 })),
		});
		const older = handleAudioHostMessage({
			type: 'OFFSCREEN_AUDIO_UPDATE',
			tabId: 23,
			generation: 2,
			controlRevision: 2,
			config: audioConfigToProcessorConfig(config({ volume: 140 })),
		});

		const [newerResult, olderResult] = await Promise.all([newer, older]);
		expectActive(newerResult, 23, 3, 3);
		expectActive(olderResult, 23, 3, 3);
		expectHost(23, 3, 3, { boostGain: 1.6 });
	});

	test('keeps the committed generation and accepts its STOP when UPDATE graph apply fails', async () => {
		await start(24, 10, DEFAULT_CONFIG);
		const apply = spyOn(AudioGraphRouter.prototype, 'apply')
			.mockImplementation(() => Promise.reject(new Error('synthetic update graph failure')));
		try {
			const failed = await handleAudioHostMessage({
				type: 'OFFSCREEN_AUDIO_UPDATE',
				tabId: 24,
				generation: 11,
				controlRevision: 2,
				config: audioConfigToProcessorConfig(config({ volume: 180 })),
			});
			expect(failed).toMatchObject({
				ok: false,
				tabId: 24,
				generation: 10,
				controlRevision: 1,
				error: { code: 'capture_update_failed' },
			});
			expectHost(24, 10, 1, { boostGain: 1 });

			const stopped = await handleAudioHostMessage({
				type: 'OFFSCREEN_AUDIO_STOP',
				tabId: 24,
				generation: 10,
			});
			expectIdle(stopped, 24, 10, 1);
			expect(describeAudioHost()).toEqual([]);
		} finally {
			apply.mockRestore();
		}
	});

	test('keeps a higher-generation stop tombstone while getUserMedia is pending', async () => {
		const gate = deferred<void>();
		audioHarness.getUserMediaGate = gate.promise;
		const pendingStart = start(15, 4, config({ volume: 240 }));
		await waitFor(() => audioHarness.getUserMediaCalls.length === 1);

		const stopped = await handleAudioHostMessage({
			type: 'OFFSCREEN_AUDIO_STOP',
			tabId: 15,
			generation: 5,
		});
		expectIdle(stopped, 15, 5, 0);

		gate.resolve();
		expectIdle(await pendingStart, 15, 5, 0);
		expect(describeAudioHost()).toEqual([]);
	});

	test('cancels a timed-out pending start without leaving a processor', async () => {
		const gate = deferred<void>();
		audioHarness.getUserMediaGate = gate.promise;
		const pendingStart = start(16, 7, config({ volume: 300 }));
		await waitFor(() => audioHarness.getUserMediaCalls.length === 1);

		expect(await handleAudioHostMessage({
			type: 'OFFSCREEN_AUDIO_CANCEL_START',
			tabId: 16,
			generation: 7,
			stopCommitted: true,
		})).toMatchObject({ ok: true, tabId: 16, generation: 7, phase: 'idle' });

		gate.resolve();
		expectIdle(await pendingStart, 16, 7, 0);
		expect(describeAudioHost()).toEqual([]);
	});

	test('rejects updates and same-generation restarts behind a stop tombstone', async () => {
		await start(18, 6, DEFAULT_CONFIG);
		const context = requireValue(
			audioHarness.contexts[0],
			'Expected the capture to create an audio context',
		);
		await handleAudioHostMessage({
			type: 'OFFSCREEN_AUDIO_STOP',
			tabId: 18,
			generation: 6,
		});

		const captureGate = requireValue(
			context.gains[0],
			'Expected the capture graph to expose its gate',
		).gain;
		const gainWrites = captureGate.writes.length;
		expect(await handleAudioHostMessage({
			type: 'OFFSCREEN_AUDIO_UPDATE',
			tabId: 18,
			generation: 6,
			controlRevision: 1,
			config: audioConfigToProcessorConfig(config({ volume: 700 })),
		})).toEqual({
			ok: false,
			tabId: 18,
			generation: 6,
			controlRevision: 1,
			error: {
				code: 'stale_capture_intent',
				message: 'Capture configuration belongs to a stopped generation',
				retryable: true,
			},
		});
		expect(captureGate.writes).toHaveLength(gainWrites);

		expect(await start(18, 6, config({ volume: 250 }))).toEqual({
			ok: false,
			tabId: 18,
			generation: 6,
			controlRevision: 1,
			error: {
				code: 'stale_capture_intent',
				message: 'Capture configuration belongs to a stopped generation',
				retryable: true,
			},
		});
		expect(audioHarness.contexts).toHaveLength(1);

		expectActive(await start(18, 7, config({ volume: 250 }), 2), 18, 7, 2);
		expect(audioHarness.contexts).toHaveLength(2);
	});

	test('removes the acknowledged processor when its capture track ends', async () => {
		await start(17, 3, DEFAULT_CONFIG);
		expectHost(17, 3, 1, { boostGain: 1 });

		const stream = requireValue(
			audioHarness.streams[0],
			'Expected the capture to create a media stream',
		);
		const context = requireValue(
			audioHarness.contexts[0],
			'Expected the capture to create an audio context',
		);
		stream.track.end();
		await waitFor(() => describeAudioHost().length === 0
			&& context.closeCalls === 1);
		expect(context.closeCalls).toBe(1);
	});

	test('acknowledges idle after exhausting best-effort processor cleanup', async () => {
		await start(20, 1, DEFAULT_CONFIG);
		const context = requireValue(
			audioHarness.contexts[0],
			'Expected the capture to create an audio context',
		);
		const commitGate = requireValue(
			context.gains[0],
			'Expected the capture graph to expose its commit gate',
		);
		commitGate.disconnect = () => {
			throw new Error('synthetic disconnect failure');
		};
		const report = spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			const stopped = await handleAudioHostMessage({
				type: 'OFFSCREEN_AUDIO_STOP',
				tabId: 20,
				generation: 2,
			});
			expectIdle(stopped, 20, 2, 1);
			expect(describeAudioHost()).toEqual([]);
			expect(context.closeCalls).toBe(1);
			expect(report).toHaveBeenCalledWith(
				'[SPECTRA] Audio processor disposal completed with cleanup failures',
				expect.any(AggregateError),
			);
		} finally {
			report.mockRestore();
		}
	});

	test('returns one throttled visualizer batch keyed by every requested tab', async () => {
		await start(21, 1, DEFAULT_CONFIG);
		await start(22, 1, DEFAULT_CONFIG);
		const firstContext = requireValue(
			audioHarness.contexts[0],
			'Expected tab 21 to create an audio context',
		);
		const secondContext = requireValue(
			audioHarness.contexts[1],
			'Expected tab 22 to create an audio context',
		);
		expect(firstContext.analysers).toHaveLength(0);
		expect(secondContext.analysers).toHaveLength(0);
		await handleAudioHostMessage({
			type: 'OFFSCREEN_AUDIO_SET_VIZ_SUBSCRIPTIONS',
			tabIds: [21, 22],
		});
		const firstAnalyser = requireValue(
			firstContext.analysers[0],
			'Expected tab 21 visualizer subscription to create an analyser',
		);
		const secondAnalyser = requireValue(
			secondContext.analysers[0],
			'Expected tab 22 visualizer subscription to create an analyser',
		);

		const firstBatch = await handleAudioHostMessage({
			type: 'OFFSCREEN_AUDIO_GET_VIZ_BATCH',
			tabIds: [21, 22, 404],
		}) as { frames: Record<string, number[] | null> };
		expect(Object.keys(firstBatch.frames)).toEqual(['21', '22', '404']);
		expect(firstBatch.frames['21']).toHaveLength(firstAnalyser.frequencyBinCount);
		expect(firstBatch.frames['22']).toHaveLength(secondAnalyser.frequencyBinCount);
		expect(firstBatch.frames['404']).toBeNull();
		expect(firstAnalyser.readCalls).toBe(1);
		expect(secondAnalyser.readCalls).toBe(1);

		const secondBatch = await handleAudioHostMessage({
			type: 'OFFSCREEN_AUDIO_GET_VIZ_BATCH',
			tabIds: [21, 22],
		}) as { frames: Record<string, number[] | null> };
		expect(secondBatch.frames['21']).toBe(firstBatch.frames['21']);
		expect(secondBatch.frames['22']).toBe(firstBatch.frames['22']);
		expect(firstAnalyser.readCalls).toBe(1);
		expect(secondAnalyser.readCalls).toBe(1);
		await handleAudioHostMessage({
			type: 'OFFSCREEN_AUDIO_SET_VIZ_SUBSCRIPTIONS',
			tabIds: [],
		});
	});
});

function start(
	tabId: number,
	generation: number,
	audioConfig: AudioConfig,
	controlRevision = 1,
): Promise<unknown> {
	return handleAudioHostMessage({
		type: 'OFFSCREEN_AUDIO_START',
		tabId,
		generation,
		streamId: `stream-${tabId}-${generation}`,
		config: audioConfigToProcessorConfig(audioConfig),
		controlRevision,
	});
}

function config(overrides: Partial<AudioConfig>): AudioConfig {
	const next = {
		...DEFAULT_CONFIG,
		eqValues: [...DEFAULT_CONFIG.eqValues],
		...overrides,
	};
	const volume = overrides.volumeBase === undefined && overrides.boost === undefined && overrides.volume !== undefined
		? splitEffectiveVolume(overrides.volume)
		: {
			volumeBase: next.volumeBase,
			boost: next.boost,
		};
	return {
		...next,
		volumeBase: volume.volumeBase,
		boost: volume.boost,
		volume: compileEffectiveVolume(volume.volumeBase, volume.boost),
	};
}

function expectActive(
	value: unknown,
	tabId: number,
	generation: number,
	controlRevision: number,
): void {
	expect(value).toMatchObject({
		ok: true,
		tabId,
		generation,
		controlRevision,
		phase: 'active',
		contextState: 'running',
		graphSignature: expect.any(String),
		normalizedActualConfig: expect.any(Object),
	});
}

function expectHost(
	tabId: number,
	generation: number,
	controlRevision: number,
	actualConfig: Record<string, unknown>,
): void {
	expect(describeAudioHost()).toEqual([
		expect.objectContaining({
			tabId,
			generation,
			controlRevision,
			graphSignature: expect.any(String),
			normalizedActualConfig: expect.objectContaining(actualConfig),
		}),
	]);
}

function expectIdle(
	value: unknown,
	tabId: number,
	generation: number,
	controlRevision: number,
): void {
	expect(value).toEqual({
		ok: true,
		tabId,
		generation,
		controlRevision,
		phase: 'idle',
		contextState: 'closed',
		graphSignature: 'none',
		normalizedActualConfig: null,
	});
}

interface AudioHarness {
	contexts: FakeAudioContext[];
	streams: FakeMediaStream[];
	getUserMediaCalls: MediaStreamConstraints[];
	getUserMediaError: Error | null;
	getUserMediaGate: Promise<void> | null;
	nextStreamHasAudio: boolean;
	restore(): void;
}

function installAudioHarness(): AudioHarness {
	const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	const audioContextDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
	const contexts: FakeAudioContext[] = [];
	const streams: FakeMediaStream[] = [];
	const getUserMediaCalls: MediaStreamConstraints[] = [];
	const harness: AudioHarness = {
		contexts,
		streams,
		getUserMediaCalls,
		getUserMediaError: null,
		getUserMediaGate: null,
		nextStreamHasAudio: true,
		restore() {
			restoreProperty('navigator', navigatorDescriptor);
			restoreProperty('AudioContext', audioContextDescriptor);
		},
	};

	class HarnessAudioContext extends FakeAudioContext {
		constructor() {
			super();
			contexts.push(this);
		}
	}

	Object.defineProperty(globalThis, 'navigator', {
		configurable: true,
		value: {
			mediaDevices: {
				getUserMedia: async (constraints: MediaStreamConstraints) => {
					getUserMediaCalls.push(constraints);
					if (harness.getUserMediaError) throw harness.getUserMediaError;
					if (harness.getUserMediaGate) await harness.getUserMediaGate;
					const stream = new FakeMediaStream(harness.nextStreamHasAudio);
					harness.nextStreamHasAudio = true;
					streams.push(stream);
					return stream as unknown as MediaStream;
				},
			},
		},
	});
	Object.defineProperty(globalThis, 'AudioContext', {
		configurable: true,
		value: HarnessAudioContext,
	});

	return harness;
}

class FakeAudioParam {
	value = 0;
	readonly writes: Array<{ value: number; startTime: number; timeConstant: number }> = [];

	get lastValue(): number | undefined {
		return this.writes.at(-1)?.value;
	}

	setTargetAtTime(value: number, startTime: number, timeConstant: number): void {
		this.value = value;
		this.writes.push({ value, startTime, timeConstant });
	}
	cancelScheduledValues(): void { }
	setValueAtTime(value: number, startTime: number): void {
		this.value = value;
		this.writes.push({ value, startTime, timeConstant: 0 });
	}
	linearRampToValueAtTime(value: number, endTime: number): void {
		this.value = value;
		this.writes.push({ value, startTime: endTime, timeConstant: 0 });
	}
}

class FakeAudioNode {
	readonly connections: FakeAudioNode[] = [];
	disconnectCalls = 0;

	connect(target: FakeAudioNode, _output?: number, _input?: number): FakeAudioNode {
		this.connections.push(target);
		return target;
	}

	disconnect(target?: FakeAudioNode): void {
		this.disconnectCalls += 1;
		if (!target) this.connections.length = 0;
		else {
			const index = this.connections.indexOf(target);
			if (index >= 0) this.connections.splice(index, 1);
		}
	}
}

class FakeGainNode extends FakeAudioNode {
	readonly gain = new FakeAudioParam();
	channelCount = 2;
	channelCountMode = 'max';
}

class FakeBiquadFilterNode extends FakeAudioNode {
	type = 'lowpass';
	readonly frequency = new FakeAudioParam();
	readonly Q = new FakeAudioParam();
	readonly gain = new FakeAudioParam();
}

class FakeDynamicsCompressorNode extends FakeAudioNode {
	readonly threshold = new FakeAudioParam();
	readonly knee = new FakeAudioParam();
	readonly ratio = new FakeAudioParam();
	readonly attack = new FakeAudioParam();
	readonly release = new FakeAudioParam();
}

class FakeStereoPannerNode extends FakeAudioNode {
	readonly pan = new FakeAudioParam();
}

class FakeDelayNode extends FakeAudioNode {
	readonly delayTime = new FakeAudioParam();
}

class FakeAnalyserNode extends FakeAudioNode {
	private fftSizeValue = 0;
	frequencyBinCount = 0;
	readCalls = 0;

	get fftSize(): number {
		return this.fftSizeValue;
	}

	set fftSize(value: number) {
		this.fftSizeValue = value;
		this.frequencyBinCount = value / 2;
	}

	getByteFrequencyData(buffer: Uint8Array): void {
		this.readCalls += 1;
		for (let index = 0; index < buffer.length; index += 1) buffer[index] = index % 256;
	}
}

class FakeMediaTrack {
	readyState: MediaStreamTrackState = 'live';
	stopCalls = 0;
	private readonly endedListeners = new Set<() => void>();
	addEventListener(type: string, listener: () => void): void {
		if (type === 'ended') this.endedListeners.add(listener);
	}
	removeEventListener(type: string, listener: () => void): void {
		if (type === 'ended') this.endedListeners.delete(listener);
	}
	end(): void {
		for (const listener of [...this.endedListeners]) listener();
	}
	stop(): void {
		this.stopCalls += 1;
	}
}

class FakeMediaStream {
	readonly track = new FakeMediaTrack();
	constructor(private readonly hasAudio: boolean) { }
	getTracks(): FakeMediaTrack[] {
		return [this.track];
	}
	getAudioTracks(): FakeMediaTrack[] {
		return this.hasAudio ? [this.track] : [];
	}
}

class FakeAudioContext {
	readonly currentTime = 10;
	readonly destination = new FakeAudioNode();
	readonly gains: FakeGainNode[] = [];
	readonly filters: FakeBiquadFilterNode[] = [];
	readonly compressors: FakeDynamicsCompressorNode[] = [];
	readonly panners: FakeStereoPannerNode[] = [];
	readonly delays: FakeDelayNode[] = [];
	readonly analysers: FakeAnalyserNode[] = [];
	readonly splitters: FakeAudioNode[] = [];
	readonly mergers: FakeAudioNode[] = [];
	state = 'suspended';
	resumeCalls = 0;
	closeCalls = 0;

	createMediaStreamSource(): FakeAudioNode {
		return new FakeAudioNode();
	}

	createGain(): FakeGainNode {
		const node = new FakeGainNode();
		this.gains.push(node);
		return node;
	}

	createBiquadFilter(): FakeBiquadFilterNode {
		const node = new FakeBiquadFilterNode();
		this.filters.push(node);
		return node;
	}

	createDynamicsCompressor(): FakeDynamicsCompressorNode {
		const node = new FakeDynamicsCompressorNode();
		this.compressors.push(node);
		return node;
	}

	createStereoPanner(): FakeStereoPannerNode {
		const node = new FakeStereoPannerNode();
		this.panners.push(node);
		return node;
	}

	createDelay(_maximum?: number): FakeDelayNode {
		const node = new FakeDelayNode();
		this.delays.push(node);
		return node;
	}

	createChannelSplitter(): FakeAudioNode {
		const node = new FakeAudioNode();
		this.splitters.push(node);
		return node;
	}

	createChannelMerger(): FakeAudioNode {
		const node = new FakeAudioNode();
		this.mergers.push(node);
		return node;
	}

	createAnalyser(): FakeAnalyserNode {
		const node = new FakeAnalyserNode();
		this.analysers.push(node);
		return node;
	}

	async resume(): Promise<void> {
		this.resumeCalls += 1;
		this.state = 'running';
	}

	async close(): Promise<void> {
		this.closeCalls += 1;
		this.state = 'closed';
	}
}

function restoreProperty(key: 'navigator' | 'AudioContext', descriptor?: PropertyDescriptor): void {
	if (descriptor) Object.defineProperty(globalThis, key, descriptor);
	else Reflect.deleteProperty(globalThis, key);
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => { resolve = done; });
	return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if (predicate()) return;
		await Promise.resolve();
	}
	throw new Error('Condition was not reached after flushing microtasks');
}
