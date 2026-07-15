import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { AudioConfig } from '@nexus/contracts';
import {
	describeAudioHost,
	destroyAudioHost,
	handleAudioHostMessage,
} from '../src/offscreen/audio-host';

const DEFAULT_CONFIG: AudioConfig = {
	enabled: true,
	volume: 100,
	muted: false,
	compressor: false,
	mono: false,
	bass: false,
	eqValues: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
	pan: 0,
	delay: 0,
	speed: 1,
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
		expect(started).toEqual({ ok: true, tabId: 7, generation: 4, phase: 'active' });
		expect(describeAudioHost()).toEqual([{ tabId: 7, generation: 4 }]);
		expect(audioHarness.getUserMediaCalls).toHaveLength(1);
		expect(audioHarness.contexts).toHaveLength(1);

		const firstContext = audioHarness.contexts[0]!;
		const firstStream = audioHarness.streams[0]!;
		expect(firstContext.resumeCalls).toBe(1);
		expect(firstContext.gains[0]!.gain.lastValue).toBe(1);
		expect(firstContext.compressors[0]!.connections).toHaveLength(0);
		expect(firstContext.delays[0]!.delayTime.lastValue).toBe(0);

		const sameGeneration = await start(7, 4, config({
			volume: 250,
			compressor: true,
			pan: 2,
			delay: -80,
		}));
		expect(sameGeneration).toEqual({ ok: true, tabId: 7, generation: 4, phase: 'active' });
		expect(audioHarness.getUserMediaCalls).toHaveLength(1);
		expect(audioHarness.contexts).toHaveLength(1);
		expect(firstContext.gains[0]!.gain.lastValue).toBe(2.5);
		expect(firstContext.compressors[0]!.connections).toEqual([firstContext.panners[0]]);
		expect(firstContext.panners[0]!.pan.lastValue).toBe(1);
		expect(firstContext.delays[0]!.delayTime.lastValue).toBe(0);

		const gainWritesBeforeStaleUpdate = firstContext.gains[0]!.gain.writes.length;
		const staleUpdate = await handleAudioHostMessage({
			type: 'OFFSCREEN_AUDIO_UPDATE',
			tabId: 7,
			generation: 3,
			config: config({ volume: 700 }),
		});
		expect(staleUpdate).toEqual({ ok: true, tabId: 7, generation: 4, phase: 'active' });
		expect(firstContext.gains[0]!.gain.writes).toHaveLength(gainWritesBeforeStaleUpdate);

		const staleStop = await handleAudioHostMessage({
			type: 'OFFSCREEN_AUDIO_STOP',
			tabId: 7,
			generation: 3,
		});
		expect(staleStop).toEqual({ ok: true, tabId: 7, generation: 4, phase: 'active' });
		expect(firstStream.track.stopCalls).toBe(0);
		expect(firstContext.closeCalls).toBe(0);

		const newerStart = await start(7, 5, DEFAULT_CONFIG);
		expect(newerStart).toEqual({ ok: true, tabId: 7, generation: 5, phase: 'active' });
		expect(firstStream.track.stopCalls).toBe(1);
		expect(firstContext.closeCalls).toBe(1);
		expect(audioHarness.contexts).toHaveLength(2);
		expect(describeAudioHost()).toEqual([{ tabId: 7, generation: 5 }]);

		const stopped = await handleAudioHostMessage({
			type: 'OFFSCREEN_AUDIO_STOP',
			tabId: 7,
			generation: 5,
		});
		expect(stopped).toEqual({ ok: true, tabId: 7, generation: 5, phase: 'idle' });
		expect(describeAudioHost()).toEqual([]);
	});

	test('returns a structured retryable failure without publishing an active processor', async () => {
		audioHarness.getUserMediaError = new Error('capture permission denied');

		const result = await start(12, 2, DEFAULT_CONFIG);

		expect(result).toEqual({
			ok: false,
			tabId: 12,
			generation: 2,
			error: {
				code: 'capture_start_failed',
				message: 'capture permission denied',
				retryable: true,
			},
		});
		expect(describeAudioHost()).toEqual([]);
		expect(audioHarness.contexts).toHaveLength(0);
	});

	test('keeps the acknowledged processor when a newer replacement cannot be created', async () => {
		await start(13, 4, DEFAULT_CONFIG);
		const originalContext = audioHarness.contexts[0]!;
		const originalStream = audioHarness.streams[0]!;
		audioHarness.getUserMediaError = new Error('replacement denied');

		const result = await start(13, 5, config({ volume: 240 }));

		expect(result).toEqual({
			ok: false,
			tabId: 13,
			generation: 5,
			error: { code: 'capture_start_failed', message: 'replacement denied', retryable: true },
		});
		expect(describeAudioHost()).toEqual([{ tabId: 13, generation: 4 }]);
		expect(originalStream.track.stopCalls).toBe(0);
		expect(originalContext.closeCalls).toBe(0);
	});

	test('advances processor generation only on an acknowledged config update', async () => {
		await start(14, 2, DEFAULT_CONFIG);
		const updated = await handleAudioHostMessage({
			type: 'OFFSCREEN_AUDIO_UPDATE',
			tabId: 14,
			generation: 3,
			config: config({ volume: 160 }),
		});

		expect(updated).toEqual({ ok: true, tabId: 14, generation: 3, phase: 'active' });
		expect(describeAudioHost()).toEqual([{ tabId: 14, generation: 3 }]);
		const staleStop = await handleAudioHostMessage({
			type: 'OFFSCREEN_AUDIO_STOP',
			tabId: 14,
			generation: 2,
		});
		expect(staleStop).toEqual({ ok: true, tabId: 14, generation: 3, phase: 'active' });
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
		expect(stopped).toEqual({ ok: true, tabId: 15, generation: 5, phase: 'idle' });

		gate.resolve();
		expect(await pendingStart).toEqual({ ok: true, tabId: 15, generation: 5, phase: 'idle' });
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
		})).toEqual({ ok: true, tabId: 16, generation: 7, phase: 'idle' });

		gate.resolve();
		expect(await pendingStart).toEqual({ ok: true, tabId: 16, generation: 7, phase: 'idle' });
		expect(describeAudioHost()).toEqual([]);
	});

	test('rejects updates and same-generation restarts behind a stop tombstone', async () => {
		await start(18, 6, DEFAULT_CONFIG);
		const context = audioHarness.contexts[0]!;
		await handleAudioHostMessage({
			type: 'OFFSCREEN_AUDIO_STOP',
			tabId: 18,
			generation: 6,
		});

		const gainWrites = context.gains[0]!.gain.writes.length;
		expect(await handleAudioHostMessage({
			type: 'OFFSCREEN_AUDIO_UPDATE',
			tabId: 18,
			generation: 6,
			config: config({ volume: 700 }),
		})).toEqual({
			ok: false,
			tabId: 18,
			generation: 6,
			error: {
				code: 'stale_capture_intent',
				message: 'Capture configuration belongs to a stopped generation',
				retryable: true,
			},
		});
		expect(context.gains[0]!.gain.writes).toHaveLength(gainWrites);

		expect(await start(18, 6, config({ volume: 250 }))).toEqual({
			ok: true,
			tabId: 18,
			generation: 6,
			phase: 'idle',
		});
		expect(audioHarness.contexts).toHaveLength(1);

		expect(await start(18, 7, config({ volume: 250 }))).toEqual({
			ok: true,
			tabId: 18,
			generation: 7,
			phase: 'active',
		});
		expect(audioHarness.contexts).toHaveLength(2);
	});

	test('removes the acknowledged processor when its capture track ends', async () => {
		await start(17, 3, DEFAULT_CONFIG);
		expect(describeAudioHost()).toEqual([{ tabId: 17, generation: 3 }]);

		audioHarness.streams[0]!.track.end();
		await waitFor(() => describeAudioHost().length === 0);
		expect(audioHarness.contexts[0]!.closeCalls).toBe(1);
	});

	test('returns one throttled visualizer batch keyed by every requested tab', async () => {
		await start(21, 1, DEFAULT_CONFIG);
		await start(22, 1, DEFAULT_CONFIG);

		const firstBatch = await handleAudioHostMessage({
			type: 'OFFSCREEN_AUDIO_GET_VIZ_BATCH',
			tabIds: [21, 22, 404],
		}) as { frames: Record<string, number[] | null> };
		expect(Object.keys(firstBatch.frames)).toEqual(['21', '22', '404']);
		expect(firstBatch.frames['21']).toHaveLength(audioHarness.contexts[0]!.analysers[0]!.frequencyBinCount);
		expect(firstBatch.frames['22']).toHaveLength(audioHarness.contexts[1]!.analysers[0]!.frequencyBinCount);
		expect(firstBatch.frames['404']).toBeNull();
		expect(audioHarness.contexts[0]!.analysers[0]!.readCalls).toBe(1);
		expect(audioHarness.contexts[1]!.analysers[0]!.readCalls).toBe(1);

		const secondBatch = await handleAudioHostMessage({
			type: 'OFFSCREEN_AUDIO_GET_VIZ_BATCH',
			tabIds: [21, 22],
		}) as { frames: Record<string, number[] | null> };
		expect(secondBatch.frames['21']).toBe(firstBatch.frames['21']);
		expect(secondBatch.frames['22']).toBe(firstBatch.frames['22']);
		expect(audioHarness.contexts[0]!.analysers[0]!.readCalls).toBe(1);
		expect(audioHarness.contexts[1]!.analysers[0]!.readCalls).toBe(1);
	});
});

function start(tabId: number, generation: number, audioConfig: AudioConfig): Promise<unknown> {
	return handleAudioHostMessage({
		type: 'OFFSCREEN_AUDIO_START',
		tabId,
		generation,
		streamId: `stream-${tabId}-${generation}`,
		config: audioConfig,
	});
}

function config(overrides: Partial<AudioConfig>): AudioConfig {
	return {
		...DEFAULT_CONFIG,
		eqValues: [...DEFAULT_CONFIG.eqValues],
		...overrides,
	};
}

interface AudioHarness {
	contexts: FakeAudioContext[];
	streams: FakeMediaStream[];
	getUserMediaCalls: MediaStreamConstraints[];
	getUserMediaError: Error | null;
	getUserMediaGate: Promise<void> | null;
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
					const stream = new FakeMediaStream();
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
}

class FakeAudioNode {
	readonly connections: FakeAudioNode[] = [];
	disconnectCalls = 0;

	connect(target: FakeAudioNode): FakeAudioNode {
		this.connections.push(target);
		return target;
	}

	disconnect(): void {
		this.disconnectCalls += 1;
		this.connections.length = 0;
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
	getTracks(): FakeMediaTrack[] {
		return [this.track];
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

	createDelay(): FakeDelayNode {
		const node = new FakeDelayNode();
		this.delays.push(node);
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
