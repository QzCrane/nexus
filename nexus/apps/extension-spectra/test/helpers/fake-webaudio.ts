export class FakeAudioParam {
	value: number;
	readonly targets: number[] = [];

	constructor(value = 0) {
		this.value = value;
	}

	setTargetAtTime(value: number): void {
		this.value = value;
		this.targets.push(value);
	}
}

export class FakeAudioNode {
	readonly connections: unknown[] = [];
	disconnectCount = 0;

	connect(target: unknown): unknown {
		this.connections.push(target);
		return target;
	}

	disconnect(): void {
		this.connections.length = 0;
		this.disconnectCount++;
	}
}

export class FakeGainNode extends FakeAudioNode {
	readonly gain = new FakeAudioParam(1);
}

export class FakeCompressorNode extends FakeAudioNode {
	readonly threshold = new FakeAudioParam();
	readonly knee = new FakeAudioParam();
	readonly ratio = new FakeAudioParam();
	readonly attack = new FakeAudioParam();
	readonly release = new FakeAudioParam();
}

export class FakeAudioContext {
	readonly rawDestination = new FakeAudioNode();
	destination: FakeAudioNode = this.rawDestination;
	readonly gains: FakeGainNode[] = [];
	readonly compressors: FakeCompressorNode[] = [];
	readonly currentTime = 0;
	closed = false;

	createGain(): FakeGainNode {
		const node = new FakeGainNode();
		this.gains.push(node);
		return node;
	}

	createDynamicsCompressor(): FakeCompressorNode {
		const node = new FakeCompressorNode();
		this.compressors.push(node);
		return node;
	}

	async close(): Promise<void> {
		this.closed = true;
	}
}

export function installFakeAudioWindow(): {
	window: Window;
	restore(): void;
} {
	const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
	const fakeWindow = { AudioContext: FakeAudioContext } as unknown as Window;
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		writable: true,
		value: fakeWindow,
	});
	return {
		window: fakeWindow,
		restore() {
			if (originalDescriptor) Object.defineProperty(globalThis, 'window', originalDescriptor);
			else delete (globalThis as { window?: Window }).window;
		},
	};
}
