import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { DEFAULT_AUDIO_CONFIG, isAudioProcessorConfig } from '@nexus/contracts';
import {
	AUDIO_GRAPH_CROSSFADE_MS,
	AudioGraphRouter,
	AudioParams,
	CompressorOn,
	DEFAULT_AUDIO_GRAPH_CONFIG,
	audioGraphSignature,
	audioConfigToGraphConfig,
} from '@nexus/audio-engine';

describe('shared sparse audio graph router', () => {
	test('keeps page volume and media mute out of processor graphs', () => {
		const processor = audioConfigToGraphConfig({
			...DEFAULT_AUDIO_CONFIG,
			eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
			muted: true,
		});
		expect(processor.boostGain).toBe(1);
		expect('muted' in processor).toBe(false);
		expect(isAudioProcessorConfig(processor)).toBe(true);
		expect(isAudioProcessorConfig({ ...processor, boostGain: 0 })).toBe(false);
		expect(isAudioProcessorConfig({ ...processor, muted: true })).toBe(false);
	});

	test('keeps canonical DSP parameters mirrored in the architecture owner', () => {
		const architecture = readFileSync(
			new URL('../docs/control-architecture.md', import.meta.url),
			'utf8',
		);
		expect(architecture).toContain(
			`peaking filters at \`${AudioParams.EQ_FREQUENCIES.join('/')}Hz\`, \`Q=${AudioParams.EQ_Q}\``,
		);
		expect(architecture).toContain(
			`\`${AudioParams.BASS_FREQUENCY}Hz\`, \`+${AudioParams.BASS_GAIN}dB\``,
		);
		expect(architecture).toContain(
			`threshold \`${CompressorOn.threshold}dB\`, knee \`${CompressorOn.knee}dB\`, ratio \`${CompressorOn.ratio}:1\`, attack \`${CompressorOn.attack}s\`, release \`${CompressorOn.release}s\``,
		);
		expect(architecture).toContain(`\`${AUDIO_GRAPH_CROSSFADE_MS}ms\` complementary linear crossfade`);
	});

	test('keeps a neutral graph sparse and connects each source only once', async () => {
		const context = new FakeAudioContext();
		const router = new AudioGraphRouter(context as unknown as AudioContext, undefined, {
			crossfadeMs: 0,
		});
		const source = new FakeAudioNode(context, 'source');
		expect(router.connectSource(source as unknown as AudioNode)).toBe(true);
		expect(router.connectSource(source as unknown as AudioNode)).toBe(false);

		const snapshot = await router.apply(DEFAULT_AUDIO_GRAPH_CONFIG, { requireRunning: true });
		expect(snapshot).toMatchObject({
			contextState: 'running',
			graphSignature: 'bass:0|eq:-|compressor:0|mono:0|pan:0|delay:0',
			sourceCount: 1,
		});
		expect(context.created.biquad).toBe(0);
		expect(context.created.compressor).toBe(0);
		expect(context.created.panner).toBe(0);
		expect(context.created.delay).toBe(0);
		expect(context.created.analyser).toBe(0);
	});

	test('creates only enabled DSP nodes in the canonical order and reuses stable topology', async () => {
		const context = new FakeAudioContext();
		const router = new AudioGraphRouter(context as unknown as AudioContext, undefined, {
			crossfadeMs: 0,
		});
		router.connectSource(new FakeAudioNode(context, 'source') as unknown as AudioNode);
		const config = {
			...DEFAULT_AUDIO_GRAPH_CONFIG,
			boostGain: 2,
			bass: true,
			eqValues: [3, 0, 0, -2, 0, 0, 0, 0, 0, 0],
			compressor: true,
			mono: true,
			pan: 0.25,
			delay: 125,
		};
		const first = await router.apply(config, { requireRunning: true });
		expect(first.normalizedActualConfig).toEqual(config);
		expect(context.created.biquad).toBe(3);
		expect(context.created.compressor).toBe(1);
		expect(context.created.splitter).toBe(1);
		expect(context.created.merger).toBe(1);
		expect(context.created.panner).toBe(1);
		expect(context.created.delay).toBe(1);
		expect(context.delayMaximums).toEqual([0.5]);

		const filterCount = context.created.biquad;
		const updated = await router.apply({
			...config,
			eqValues: [6, 0, 0, -1, 0, 0, 0, 0, 0, 0],
			pan: -0.5,
		});
		expect(updated.graphSignature).toBe(first.graphSignature);
		expect(context.created.biquad).toBe(filterCount);
	});

	test('ramps delay values in one topology and creates analyser only while subscribed', async () => {
		const context = new FakeAudioContext();
		const router = new AudioGraphRouter(context as unknown as AudioContext, undefined, {
			crossfadeMs: 0,
		});
		await router.apply({ ...DEFAULT_AUDIO_GRAPH_CONFIG, delay: 50 });
		const firstSignature = router.getSnapshot()?.graphSignature;
		await router.apply({ ...DEFAULT_AUDIO_GRAPH_CONFIG, delay: 75 });
		expect(router.getSnapshot()?.graphSignature).toBe(firstSignature);
		expect(context.created.delay).toBe(1);
		expect(router.getSnapshot()?.normalizedActualConfig.delay).toBe(75);
		expect(context.created.analyser).toBe(0);

		const unsubscribe = router.subscribeVisualizer();
		expect(context.created.analyser).toBe(1);
		expect(router.getVisualizerData()).toHaveLength(128);
		unsubscribe();
		expect(router.getVisualizerData()).toBeNull();
	});

	test('normalizes topology signatures independently from parameter-only updates', () => {
		const base = { ...DEFAULT_AUDIO_GRAPH_CONFIG, eqValues: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
		expect(audioGraphSignature(base)).toBe(audioGraphSignature({
			...base,
			eqValues: [6, 0, 0, 0, 0, 0, 0, 0, 0, 0],
		}));
		expect(audioGraphSignature(base)).not.toBe(audioGraphSignature({
			...base,
			eqValues: [0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
		}));
	});
});

class FakeAudioParam {
	value = 0;
	cancelScheduledValues(): void { }
	setValueAtTime(value: number): void { this.value = value; }
	linearRampToValueAtTime(value: number): void { this.value = value; }
}

class FakeAudioNode {
	readonly gain = new FakeAudioParam();
	readonly frequency = new FakeAudioParam();
	readonly Q = new FakeAudioParam();
	readonly threshold = new FakeAudioParam();
	readonly knee = new FakeAudioParam();
	readonly ratio = new FakeAudioParam();
	readonly attack = new FakeAudioParam();
	readonly release = new FakeAudioParam();
	readonly pan = new FakeAudioParam();
	readonly delayTime = new FakeAudioParam();
	readonly connections: FakeAudioNode[] = [];
	channelCount = 2;
	type = '';
	fftSize = 0;
	frequencyBinCount = 0;
	disconnected = false;

	constructor(readonly context: FakeAudioContext, readonly kind: string) { }

	connect(target: FakeAudioNode): FakeAudioNode {
		this.connections.push(target);
		return target;
	}

	disconnect(target?: FakeAudioNode): void {
		this.disconnected = true;
		if (!target) this.connections.length = 0;
		else {
			const index = this.connections.indexOf(target);
			if (index >= 0) this.connections.splice(index, 1);
		}
	}
}

class FakeAnalyserNode extends FakeAudioNode {
	frequencyBinCount = 128;
	getByteFrequencyData(data: Uint8Array): void { data.fill(7); }
}

class FakeAudioContext {
	readonly state = 'running' as const;
	readonly currentTime = 1;
	readonly destination = new FakeAudioNode(this, 'destination');
	readonly delayMaximums: number[] = [];
	readonly created = {
		gain: 0,
		biquad: 0,
		compressor: 0,
		panner: 0,
		delay: 0,
		analyser: 0,
		splitter: 0,
		merger: 0,
	};

	createGain(): FakeAudioNode { this.created.gain += 1; return new FakeAudioNode(this, 'gain'); }
	createBiquadFilter(): FakeAudioNode {
		this.created.biquad += 1;
		return new FakeAudioNode(this, 'biquad');
	}
	createDynamicsCompressor(): FakeAudioNode {
		this.created.compressor += 1;
		return new FakeAudioNode(this, 'compressor');
	}
	createStereoPanner(): FakeAudioNode {
		this.created.panner += 1;
		return new FakeAudioNode(this, 'panner');
	}
	createDelay(maximum: number): FakeAudioNode {
		this.created.delay += 1;
		this.delayMaximums.push(maximum);
		return new FakeAudioNode(this, 'delay');
	}
	createAnalyser(): FakeAnalyserNode {
		this.created.analyser += 1;
		return new FakeAnalyserNode(this, 'analyser');
	}
	createChannelSplitter(): FakeAudioNode {
		this.created.splitter += 1;
		return new FakeAudioNode(this, 'splitter');
	}
	createChannelMerger(): FakeAudioNode {
		this.created.merger += 1;
		return new FakeAudioNode(this, 'merger');
	}
}
