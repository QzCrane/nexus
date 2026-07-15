import { describe, expect, test } from 'bun:test';
import { WebAudioController } from '@nexus/audio-engine';

describe('WebAudio media source ownership', () => {
	test('does not bind a media element twice when page code removes public markers', async () => {
		const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
		const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
		const audioContextDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
		let sourceCreations = 0;

		class TestAudioContext {
			readonly currentTime = 0;
			readonly destination = new TestNode();
			readonly state = 'running';
			createMediaElementSource(): TestNode {
				sourceCreations += 1;
				return new TestNode(this);
			}
			createGain(): TestNode { return new TestNode(this, ['gain']); }
			createBiquadFilter(): TestNode { return new TestNode(this, ['frequency', 'Q', 'gain']); }
			createDynamicsCompressor(): TestNode {
				return new TestNode(this, ['threshold', 'knee', 'ratio', 'attack', 'release']);
			}
			createAnalyser(): TestNode { return new TestNode(this); }
			createStereoPanner(): TestNode { return new TestNode(this, ['pan']); }
			createDelay(): TestNode { return new TestNode(this, ['delayTime']); }
		}

		Object.defineProperty(globalThis, 'AudioContext', {
			configurable: true,
			value: TestAudioContext,
		});
		Object.defineProperty(globalThis, 'window', {
			configurable: true,
			value: { AudioContext: TestAudioContext },
		});
		Object.defineProperty(globalThis, 'document', {
			configurable: true,
			value: { querySelectorAll: () => [] },
		});

		const media = {
			dataset: {},
			src: '',
			crossOrigin: '',
			addEventListener: () => undefined,
		} as unknown as HTMLMediaElement & { _vm?: unknown };

		try {
			const controller = new WebAudioController();
			controller.setSkipCorsCheck(true);
			expect(await controller.initialize()).toBe(true);
			expect(controller.attachNode(media)).toBe(true);
			expect(sourceCreations).toBe(1);

			delete media._vm;
			delete media.dataset.vmAttached;
			delete media.dataset.vmProbed;
			expect(controller.attachNode(media)).toBe(false);
			expect(sourceCreations).toBe(1);
		} finally {
			restore('window', windowDescriptor);
			restore('document', documentDescriptor);
			restore('AudioContext', audioContextDescriptor);
		}
	});
});

class TestParam {
	value = 0;
	setTargetAtTime(value: number): void { this.value = value; }
}

class TestNode {
	readonly context: unknown;
	readonly frequency = new TestParam();
	readonly Q = new TestParam();
	readonly gain = new TestParam();
	readonly threshold = new TestParam();
	readonly knee = new TestParam();
	readonly ratio = new TestParam();
	readonly attack = new TestParam();
	readonly release = new TestParam();
	readonly pan = new TestParam();
	readonly delayTime = new TestParam();
	fftSize = 0;
	frequencyBinCount = 0;
	type = '';

	constructor(context?: unknown, _params: string[] = []) { this.context = context; }
	connect(target: unknown): unknown { return target; }
	disconnect(): void { }
}

function restore(
	key: 'window' | 'document' | 'AudioContext',
	descriptor?: PropertyDescriptor,
): void {
	if (descriptor) Object.defineProperty(globalThis, key, descriptor);
	else Reflect.deleteProperty(globalThis, key);
}
