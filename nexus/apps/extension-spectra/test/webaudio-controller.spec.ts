import { describe, expect, test } from 'bun:test';
import {
	WebAudioController,
	assessMediaSourceCoverage,
	assessMediaSourceEligibility,
} from '@nexus/audio-engine';

describe('WebAudio media source ownership', () => {
	test('binds one proven same-origin source for the page lifetime', async () => {
		const harness = installHarness();
		try {
			const media = createMedia('https://media.example/audio.mp3');
			const controller = new WebAudioController();
			expect(await controller.initialize()).toBe(true);
			expect(controller.attachNode(media)).toBe(true);
			expect(harness.sourceCreations()).toBe(1);
			expect(controller.ensureAttached(media)).toBe(true);
			expect(harness.sourceCreations()).toBe(1);
			expect(controller.hasCompleteCoverage([media])).toBe(true);
			expect(controller.getActualSnapshot()).toBeNull();

			const applied = await controller.applyConfig({
				enabled: true,
				volume: 200,
				muted: false,
				compressor: false,
				mono: false,
				bass: false,
				eqValues: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
				pan: 0,
				delay: 0,
				speed: 1,
			});
			expect(applied).toMatchObject({
				contextState: 'running',
				normalizedActualConfig: { boostGain: 2 },
				sourceCount: 1,
			});
		} finally {
			harness.restore();
		}
	});

	test('requires every current registry media element before claiming full coverage', async () => {
		const harness = installHarness();
		try {
			const first = createMedia('https://media.example/first.mp3');
			const second = createMedia('https://media.example/second.mp3');
			const controller = new WebAudioController();
			expect(assessMediaSourceCoverage([first, second])).toMatchObject({
				eligibility: 'proven',
				fullCoverage: true,
				total: 2,
				eligible: 2,
			});
			expect(await controller.initialize()).toBe(true);
			expect(controller.ensureAttached(first)).toBe(true);
			expect(controller.hasCompleteCoverage([first, second])).toBe(false);
			expect(controller.ensureAttached(second)).toBe(true);
			expect(controller.hasCompleteCoverage([first, second])).toBe(true);
			expect(harness.sourceCreations()).toBe(2);
		} finally {
			harness.restore();
		}
	});

	test('does not treat one safe source as complete coverage when another is unknown or unsafe', () => {
		const harness = installHarness();
		try {
			const safe = createMedia('https://media.example/first.mp3');
			const unselected = createMedia('');
			const crossOrigin = createMedia('https://cdn.example/second.mp3');
			expect(assessMediaSourceCoverage([safe, unselected])).toMatchObject({
				eligibility: 'unknown',
				fullCoverage: false,
				eligible: 1,
			});
			expect(assessMediaSourceCoverage([safe, crossOrigin])).toMatchObject({
				eligibility: 'unsafe',
				fullCoverage: false,
				eligible: 1,
			});
		} finally {
			harness.restore();
		}
	});

	test('rejects unknown cross-origin resources before irreversible binding', async () => {
		const harness = installHarness();
		try {
			const media = createMedia('https://cdn.example/audio.mp3');
			media.crossOrigin = '';
			expect(assessMediaSourceEligibility(media)).toMatchObject({
				eligible: false,
				reason: 'cross-origin-unproven',
			});
			const controller = new WebAudioController();
			expect(await controller.initialize()).toBe(true);
			expect(controller.attachNode(media)).toBe(false);
			expect(media.crossOrigin).toBe('');
			expect(harness.sourceCreations()).toBe(0);
			expect(controller.attachNode(media, {
				kind: 'preload-cors',
				resourceUrl: media.currentSrc,
			})).toBe(true);
			expect(harness.sourceCreations()).toBe(1);
		} finally {
			harness.restore();
		}
	});

	test('reactivates a detached element without creating a second media source', async () => {
		const harness = installHarness();
		try {
			const media = createMedia('https://media.example/audio.mp3');
			const controller = new WebAudioController();
			expect(await controller.initialize()).toBe(true);
			expect(controller.attachNode(media)).toBe(true);
			controller.detachNode(media);
			expect(controller.hasCompleteCoverage([media])).toBe(false);
			expect(controller.ensureAttached(media)).toBe(true);
			expect(controller.hasCompleteCoverage([media])).toBe(true);
			expect(harness.sourceCreations()).toBe(1);
		} finally {
			harness.restore();
		}
	});

	test('does not detach a page-lifetime source owned by another controller handoff', async () => {
		const harness = installHarness();
		try {
			const media = createMedia('https://media.example/audio.mp3');
			const owner = new WebAudioController();
			const handoff = new WebAudioController();
			expect(await owner.initialize()).toBe(true);
			expect(await handoff.initialize()).toBe(true);
			expect(owner.ensureAttached(media)).toBe(true);

			handoff.detachNode(media);
			expect(harness.sourceDisconnects()).toBe(0);
			expect(owner.hasCompleteCoverage([media])).toBe(true);

			owner.detachNode(media);
			expect(harness.sourceDisconnects()).toBe(1);
		} finally {
			harness.restore();
		}
	});

	test('waits for resource selection without reporting a false CORS boundary', async () => {
		const harness = installHarness();
		try {
			const media = createMedia('');
			const controller = new WebAudioController();
			expect(await controller.initialize()).toBe(true);
			expect(controller.attachNode(media)).toBe(false);
			expect(harness.sourceCreations()).toBe(0);
		} finally {
			harness.restore();
		}
	});

	test('allocates one analyser only for an explicit subscription and reuses it across samples', async () => {
		const harness = installHarness();
		try {
			const media = createMedia('https://media.example/audio.mp3');
			const controller = new WebAudioController();
			expect(await controller.initialize()).toBe(true);
			expect(controller.attachNode(media)).toBe(true);
			expect(controller.getVisualizerData()).toBeNull();
			expect(harness.analyserCreations()).toBe(0);
			expect(controller.setVisualizerSubscribed(true)).toBe(true);
			expect(harness.analyserCreations()).toBe(1);
			expect(controller.getVisualizerData()).toHaveLength(128);
			expect(controller.getVisualizerData()).toHaveLength(128);
			expect(harness.analyserCreations()).toBe(1);
			expect(controller.setVisualizerSubscribed(false)).toBe(false);
			expect(controller.getVisualizerData()).toBeNull();
		} finally {
			harness.restore();
		}
	});

	test('keeps an explicit analyser lease across a temporary processing bypass', async () => {
		const harness = installHarness();
		try {
			const media = createMedia('https://media.example/audio.mp3');
			const controller = new WebAudioController();
			expect(await controller.initialize()).toBe(true);
			expect(controller.attachNode(media)).toBe(true);
			expect(controller.setVisualizerSubscribed(true)).toBe(true);
			expect(harness.analyserCreations()).toBe(1);

			await controller.cleanup();

			expect(controller.getVisualizerData()).toHaveLength(128);
			expect(harness.analyserCreations()).toBe(1);
			expect(controller.setVisualizerSubscribed(false)).toBe(false);
		} finally {
			harness.restore();
		}
	});
});

function createMedia(currentSrc: string): HTMLMediaElement {
	return {
		currentSrc,
		src: currentSrc,
		crossOrigin: '',
	} as unknown as HTMLMediaElement;
}

function installHarness(): {
	sourceCreations(): number;
	sourceDisconnects(): number;
	analyserCreations(): number;
	restore(): void;
} {
	const descriptors = new Map<PropertyKey, PropertyDescriptor | undefined>();
	for (const key of ['window', 'document', 'location', 'AudioContext'] as const) {
		descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
	}
	let sources = 0;
	let analysers = 0;
	let lastSource: TestNode | null = null;

	class TestAudioContext {
		readonly currentTime = 0;
		readonly destination = new TestNode(this);
		readonly state = 'running';
		createMediaElementSource(): TestNode {
			sources += 1;
			lastSource = new TestNode(this);
			return lastSource;
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
		value: { baseURI: 'https://media.example/page', querySelectorAll: () => [] },
	});
	Object.defineProperty(globalThis, 'location', {
		configurable: true,
		value: {
			href: 'https://media.example/page',
			origin: 'https://media.example',
			hostname: 'media.example',
		},
	});

	return {
		sourceCreations: () => sources,
		sourceDisconnects: () => lastSource?.disconnectCalls ?? 0,
		analyserCreations: () => analysers,
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
	cancelScheduledValues(): void { }
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
	disconnectCalls = 0;

	constructor(readonly context: unknown) { }
	connect(target: unknown): unknown { return target; }
	disconnect(): void { this.disconnectCalls += 1; }
	getByteFrequencyData(data: Uint8Array): void { data.fill(0); }
}
