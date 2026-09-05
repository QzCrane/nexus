import { describe, expect, test } from 'bun:test';
import {
	WebAudioController,
	assessMediaSourceCoverage,
	assessMediaSourceEligibility,
} from '@nexus/audio-engine';
import { DEFAULT_AUDIO_CONFIG } from '@nexus/contracts';

describe('Media WebAudio ownership', () => {
	test('binds one proven source for the page lifetime and reads back the committed graph', async () => {
		const harness = installHarness();
		try {
			const media = createMedia('https://media.example/audio.mp3');
			const controller = new WebAudioController();
			expect(await controller.initialize(true)).toBe(true);
			expect(controller.ensureAttached(media)).toBe(true);
			expect(controller.ensureAttached(media)).toBe(true);
			expect(harness.sourceCreations()).toBe(1);
			const config = {
				...DEFAULT_AUDIO_CONFIG,
				volume: 200,
				volumeBase: 100,
				boost: 2,
				eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
			};
			const applied = await controller.applyConfig(config);
			expect(applied).toMatchObject({
				contextState: 'running',
				normalizedActualConfig: { boostGain: 2 },
				sourceCount: 1,
			});
			expect(controller.getActualSnapshot()).toEqual(applied);
		} finally {
			harness.restore();
		}
	});

	test('requires complete proven coverage before any irreversible binding', async () => {
		const harness = installHarness();
		try {
			const safe = createMedia('https://media.example/first.mp3');
			const unknown = createMedia('');
			const unsafe = createMedia('https://cdn.example/second.mp3');
			expect(assessMediaSourceCoverage([safe, unknown])).toMatchObject({
				eligibility: 'unknown', fullCoverage: false, eligible: 1,
			});
			expect(assessMediaSourceCoverage([safe, unsafe])).toMatchObject({
				eligibility: 'unsafe', fullCoverage: false, eligible: 1,
			});
			const controller = new WebAudioController();
			expect(await controller.initialize()).toBe(true);
			expect(controller.canAttachAll([safe, unsafe])).toBe(false);
			expect(controller.ensureAttached(unsafe)).toBe(false);
			expect(harness.sourceCreations()).toBe(0);
		} finally {
			harness.restore();
		}
	});

	test('accepts exact preload CORS evidence without mutating the page element', async () => {
		const harness = installHarness();
		try {
			const media = createMedia('https://cdn.example/audio.mp3');
			expect(assessMediaSourceEligibility(media).reason).toBe('cross-origin-unproven');
			const controller = new WebAudioController();
			expect(await controller.initialize()).toBe(true);
			expect(controller.ensureAttached(media, {
				kind: 'preload-cors',
				resourceUrl: media.currentSrc,
			})).toBe(true);
			expect(media.crossOrigin).toBe('');
			expect(harness.sourceCreations()).toBe(1);
		} finally {
			harness.restore();
		}
	});

	test('reconnects a detached element and a replacement controller without a second source', async () => {
		const harness = installHarness();
		try {
			const media = createMedia('https://media.example/audio.mp3');
			const first = new WebAudioController();
			expect(await first.initialize()).toBe(true);
			expect(first.ensureAttached(media)).toBe(true);
			first.detachNode(media);
			const replacement = new WebAudioController();
			expect(await replacement.initialize()).toBe(true);
			expect(replacement.ensureAttached(media)).toBe(true);
			expect(harness.sourceCreations()).toBe(1);
			expect(replacement.hasCompleteCoverage([media])).toBe(true);
		} finally {
			harness.restore();
		}
	});

	test('disconnects owned sources on dispose and lets the next runtime owner reconnect them', async () => {
		const harness = installHarness();
		try {
			const media = createMedia('https://media.example/audio.mp3');
			const first = new WebAudioController();
			expect(await first.initialize()).toBe(true);
			expect(first.ensureAttached(media)).toBe(true);
			first.dispose();
			expect(harness.firstSource()?.disconnectCount).toBe(1);

			const replacement = new WebAudioController();
			expect(await replacement.initialize()).toBe(true);
			expect(replacement.ensureAttached(media)).toBe(true);
			expect(harness.sourceCreations()).toBe(1);
			expect(harness.firstSource()?.connectCount).toBe(2);
		} finally {
			harness.restore();
		}
	});

	test('allocates one analyser only for an explicit lease and keeps it through neutral bypass', async () => {
		const harness = installHarness();
		try {
			const media = createMedia('https://media.example/audio.mp3');
			const controller = new WebAudioController();
			expect(await controller.initialize()).toBe(true);
			expect(controller.ensureAttached(media)).toBe(true);
			expect(controller.getVisualizerData()).toBeNull();
			expect(controller.setVisualizerSubscribed(true)).toBe(true);
			expect(controller.getVisualizerData()?.slice(0, 4)).toEqual(new Uint8Array([0, 1, 2, 3]));
			await controller.bypass();
			expect(controller.getVisualizerData()).toHaveLength(128);
			expect(harness.analyserCreations()).toBe(1);
			controller.dispose();
			expect(controller.getVisualizerData()).toBeNull();
		} finally {
			harness.restore();
		}
	});
});

function createMedia(currentSrc: string): HTMLMediaElement {
	return { currentSrc, src: currentSrc, crossOrigin: '' } as unknown as HTMLMediaElement;
}

function installHarness(): {
	sourceCreations(): number;
	analyserCreations(): number;
	firstSource(): TestNode | undefined;
	restore(): void;
} {
	const descriptors = new Map<PropertyKey, PropertyDescriptor | undefined>();
	for (const key of ['window', 'document', 'location', 'AudioContext'] as const) {
		descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
	}
	let sources = 0;
	let analysers = 0;
	const sourceNodes: TestNode[] = [];
	class TestAudioContext {
		readonly currentTime = 0;
		readonly destination = new TestNode(this);
		readonly state = 'running';
		resume(): Promise<void> { return Promise.resolve(); }
		createMediaElementSource(): TestNode {
			sources += 1;
			const source = new TestNode(this);
			sourceNodes.push(source);
			return source;
		}
		createGain(): TestNode { return new TestNode(this); }
		createBiquadFilter(): TestNode { return new TestNode(this); }
		createDynamicsCompressor(): TestNode { return new TestNode(this); }
		createAnalyser(): TestNode { analysers += 1; return new TestNode(this); }
		createStereoPanner(): TestNode { return new TestNode(this); }
		createDelay(): TestNode { return new TestNode(this); }
		createChannelSplitter(): TestNode { return new TestNode(this); }
		createChannelMerger(): TestNode { return new TestNode(this); }
	}
	const testWindow = { AudioContext: TestAudioContext } as unknown as Window;
	Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: TestAudioContext });
	Object.defineProperty(globalThis, 'window', { configurable: true, value: testWindow });
	Object.defineProperty(globalThis, 'document', {
		configurable: true,
		value: { baseURI: 'https://media.example/page' },
	});
	Object.defineProperty(globalThis, 'location', {
		configurable: true,
		value: { href: 'https://media.example/page', origin: 'https://media.example' },
	});
	return {
		sourceCreations: () => sources,
		analyserCreations: () => analysers,
		firstSource: () => sourceNodes[0],
		restore() {
			for (const [key, descriptor] of descriptors) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor);
				else Reflect.deleteProperty(globalThis, key);
			}
		},
	};
}

class TestParam {
	value = 0;
	cancelScheduledValues(): void {}
	setValueAtTime(value: number): void { this.value = value; }
	linearRampToValueAtTime(value: number): void { this.value = value; }
}

class TestNode {
	readonly gain = new TestParam();
	readonly frequency = new TestParam();
	readonly Q = new TestParam();
	readonly threshold = new TestParam();
	readonly knee = new TestParam();
	readonly ratio = new TestParam();
	readonly attack = new TestParam();
	readonly release = new TestParam();
	readonly pan = new TestParam();
	readonly delayTime = new TestParam();
	channelCount = 2;
	fftSize = 256;
	frequencyBinCount = 128;
	type = '';
	connectCount = 0;
	disconnectCount = 0;
	constructor(readonly context: unknown) {}
	connect(target: unknown): unknown { this.connectCount += 1; return target; }
	disconnect(): void { this.disconnectCount += 1; }
	getByteFrequencyData(data: Uint8Array): void {
		for (let index = 0; index < data.length; index += 1) data[index] = index;
	}
}
