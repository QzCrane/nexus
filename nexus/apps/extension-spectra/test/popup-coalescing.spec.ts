import { afterEach, describe, expect, test } from 'bun:test';
import {
	DEFAULT_AUDIO_CONFIG,
	DEFAULT_GLOBAL_SETTINGS,
	type ControlApplyAck,
	type ControlSnapshot,
} from '@nexus/contracts';
import type { PopupControlPortResponse } from '../src/shared/popup-control-port';
import type { PopupControlTransport } from '../src/popup/card/control-port';
import { applyControlSnapshot } from '../src/popup/card/messaging';
import { resolveVolumePresentation } from '../src/popup/card/render';
import { createUpdateFn } from '../src/popup/card/state';
import type { CardInternalState } from '../src/popup/card/types';
import { COLORS } from '../src/popup/constants';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

afterEach(() => restoreProperty('window', originalWindow));

describe('Popup Background-owned control transport projection', () => {
	test('stages every input synchronously and leaves 100-value coalescing to Background', () => {
		const harness = installHarness();
		const update = createUpdate(harness.transport);

		for (let index = 0; index < 100; index += 1) update({ volume: 101 + index });

		expect(harness.stages).toHaveLength(100);
		expect(harness.stages.map(({ inputRevision }) => inputRevision))
			.toEqual(Array.from({ length: 100 }, (_, index) => index + 1));
		expect(harness.stages.at(-1)?.effectiveVolume).toBe(200);
		expect(harness.flushCalls).toEqual([]);
	});

	test('does not let an older settlement replace a newer optimistic value', () => {
		const harness = installHarness();
		const state = createState();
		const update = createUpdate(harness.transport, state);

		update({ volume: 110 });
		update({ volume: 120 });
		harness.emit(settlement(1, { volume: 110 }));

		expect(state.stableConfig.volume).toBe(110);
		expect(state.config.volume).toBe(120);
		expect(state.controlRevision).toBe(1);
	});

	test('commits a successful volume ACK and rolls back only the current unacknowledged projection', async () => {
		const harness = installHarness();
		const state = createState();
		const errors: string[] = [];
		const update = createUpdate(harness.transport, state, (error) => {
			errors.push(error instanceof Error ? error.message : String(error));
		});
		const response = settlement(1, {
			volume: 110,
			error: { code: 'control_failed', message: 'speed unavailable', retryable: true },
		});
		harness.onFlush(async () => {
			harness.emit(response);
			return response;
		});

		update({ volume: 110, speed: 1.25 });
		await expect(update.flush()).rejects.toThrow('speed unavailable');

		expect(state.stableConfig.volume).toBe(110);
		expect(state.config.volume).toBe(110);
		expect(state.stableConfig.speed).toBe(DEFAULT_AUDIO_CONFIG.speed);
		expect(state.config.speed).toBe(DEFAULT_AUDIO_CONFIG.speed);
		expect(state.lastError).toEqual(response.error);
		expect(errors).toEqual(['speed unavailable']);
	});

	test('tracks pending volume until the matching Background settlement', () => {
		const harness = installHarness();
		const update = createUpdate(harness.transport);

		update({ volume: 110 });
		expect(update.hasPendingVolume()).toBe(true);
		harness.emit(settlement(1, { volume: 110 }));
		expect(update.hasPendingVolume()).toBe(false);
	});

	test('keeps pending DSP optimistic when an accepted Background snapshot carries an older value', () => {
		const harness = installHarness();
		const state = createState();
		state.controlSnapshot = controlSnapshot(1, 1);
		state.controlGeneration = 1;
		state.controlRevision = 1;
		const update = createUpdate(harness.transport, state);

		update({ speed: 1.5 });
		const accepted = applyControlSnapshot(
			state,
			controlSnapshot(2, 1.25),
			() => undefined,
			update.hasPendingVolume(),
			update.pendingConfigFields(),
		);

		expect(accepted).toBe(true);
		expect(state.stableConfig.speed).toBe(1.25);
		expect(state.config.speed).toBe(1.5);
	});

	test('rejects stale ACK and broadcast projections in both arrival orders', () => {
		const harness = installHarness();
		const state = createState();
		state.controlSnapshot = controlSnapshot(5, 1.25);
		state.controlGeneration = 5;
		state.controlRevision = 5;
		state.stableConfig.speed = 1.25;
		state.config.speed = 1.25;
		const update = createUpdate(harness.transport, state);

		update({ speed: 1.5 });
		harness.emit(settlement(1, { fieldAcks: [speedAck(4, 0.75)] }));
		expect(state.stableConfig.speed).toBe(1.25);
		expect(state.config.speed).toBe(1.5);

		harness.emit(settlement(2, { fieldAcks: [speedAck(6, 1.5)] }));
		expect(state.stableConfig.speed).toBe(1.5);
		expect(state.config.speed).toBe(1.5);
		expect(applyControlSnapshot(
			state,
			controlSnapshot(5, 0.5),
			() => undefined,
			update.hasPendingVolume(),
			update.pendingConfigFields(),
		)).toBe(false);
		expect(state.stableConfig.speed).toBe(1.5);
		expect(state.config.speed).toBe(1.5);
	});

	test('rejects a same-generation stale volume result without rolling back the volume triple', () => {
		const harness = installHarness();
		const state = createState();
		state.controlSnapshot = controlSnapshot(5, 1.25, 1);
		state.controlGeneration = 1;
		state.controlRevision = 5;
		state.stableConfig = { ...state.stableConfig, volume: 120, volumeBase: 100, boost: 1.2 };
		state.config = { ...state.config, volume: 120, volumeBase: 100, boost: 1.2 };
		createUpdate(harness.transport, state);

		harness.emit(settlement(1, {
			volume: 80,
			ackGeneration: 1,
			ackRevision: 4,
		}));

		expect(state.stableConfig).toMatchObject({ volume: 120, volumeBase: 100, boost: 1.2 });
		expect(state.config).toMatchObject({ volume: 120, volumeBase: 100, boost: 1.2 });
	});

	test('flushes staged input before dispatching a discrete control', async () => {
		const harness = installHarness();
		const update = createUpdate(harness.transport);
		const pendingFlush = deferred<PopupControlPortResponse | null>();
		let commandRan = false;
		harness.onFlush(() => pendingFlush.promise);

		update({ speed: 1.25 });
		const command = update.runControl(async () => {
			commandRan = true;
			return 'done';
		});
		await Promise.resolve();

		expect(harness.flushCalls).toEqual([1]);
		expect(commandRan).toBe(false);
		pendingFlush.resolve(null);
		expect(await command).toBe('done');
		expect(commandRan).toBe(true);
	});

	test('holds a second command behind a newer stage and its flush', async () => {
		const harness = installHarness();
		const update = createUpdate(harness.transport);
		const firstCommand = deferred<void>();
		const newerFlush = deferred<PopupControlPortResponse | null>();
		let secondRan = false;
		harness.onFlush((revision) => revision === 0 ? Promise.resolve(null) : newerFlush.promise);

		const first = update.runControl(() => firstCommand.promise);
		await Promise.resolve();
		update({ speed: 1.25 });
		const second = update.runControl(async () => { secondRan = true; });
		await Promise.resolve();
		expect(harness.flushCalls).toEqual([0]);
		expect(secondRan).toBe(false);

		firstCommand.resolve();
		await first;
		await waitFor(() => harness.flushCalls.length === 2);
		expect(harness.flushCalls).toEqual([0, 1]);
		expect(secondRan).toBe(false);
		newerFlush.resolve(null);
		await second;
		expect(secondRan).toBe(true);
	});

	test('renders 100↔110 immediately while processor colour follows only current ACKs', () => {
		const harness = installHarness();
		const state = createState();
		const frames: Array<{ effectiveVolume: number; color: string }> = [];
		const update = createUpdate(harness.transport, state, () => undefined, () => {
			frames.push(resolveVolumePresentation(state));
		});

		update({ volume: 110 });
		expect(frames.at(-1)).toEqual({ effectiveVolume: 110, color: COLORS.NATIVE });
		harness.emit(settlement(1, { volume: 110, processor: 'capture' }));
		expect(frames.at(-1)).toEqual({ effectiveVolume: 110, color: COLORS.CAPTURE });

		update({ volume: 100 });
		expect(frames.at(-1)).toEqual({ effectiveVolume: 100, color: COLORS.CAPTURE });
		harness.emit(settlement(2, { volume: 100, processor: 'observe' }));
		expect(frames.at(-1)).toEqual({ effectiveVolume: 100, color: COLORS.NATIVE });
	});
});

function createUpdate(
	transport: PopupControlTransport,
	state = createState(),
	onError: (error: unknown) => void = () => undefined,
	render: () => void = () => undefined,
) {
	return createUpdateFn(
		state,
		5,
		() => false,
		render,
		() => DEFAULT_GLOBAL_SETTINGS,
		onError,
		transport,
	);
}

function installHarness() {
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: new EventTarget(),
	});
	const stages: Array<Parameters<PopupControlTransport['stage']>[0]> = [];
	const flushCalls: number[] = [];
	const listeners = new Set<(response: PopupControlPortResponse) => void>();
	let flushHandler: PopupControlTransport['flush'] = async () => null;
	const harness = {
		stages,
		flushCalls,
		onFlush(handler: PopupControlTransport['flush']) {
			flushHandler = handler;
		},
		emit(response: PopupControlPortResponse) {
			for (const listener of listeners) listener(response);
		},
		transport: {
			stage(input) { stages.push(structuredClone(input)); },
			flush(throughRevision) {
				flushCalls.push(throughRevision);
				return flushHandler(throughRevision);
			},
			onSettled(listener) {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			hasPendingVolume() {
				return false;
			},
			dispose() { listeners.clear(); },
		} satisfies PopupControlTransport,
	};
	return harness;
}

function settlement(
	throughRevision: number,
	options: {
		volume?: number;
		ackGeneration?: number;
		ackRevision?: number;
		processor?: 'capture' | 'observe';
		fieldAcks?: ControlApplyAck[];
		error?: PopupControlPortResponse['error'];
	},
): PopupControlPortResponse {
	const effectiveVolume = options.volume;
	const acknowledgementGeneration = options.ackGeneration ?? throughRevision;
	const acknowledgementRevision = options.ackRevision ?? throughRevision;
	const volumeBase = effectiveVolume === undefined ? undefined : Math.min(effectiveVolume, 100);
	const boost = effectiveVolume === undefined ? undefined : effectiveVolume / (volumeBase ?? 100);
	return {
		type: 'settled',
		sessionId: 'popup-test-session',
		throughRevision,
		volumeAck: effectiveVolume === undefined ? null : {
			operationId: `volume-${acknowledgementGeneration}-${acknowledgementRevision}`,
			tabId: 5,
			documentId: 'document-popup',
			generation: acknowledgementGeneration,
			revision: acknowledgementRevision,
			target: null,
			operation: 'effective-volume',
			strategy: 'extension-state',
			coverage: effectiveVolume > 100 ? 'full' : 'active-target',
			fields: options.processor ? {
				boost: controlField(
					boost ?? 1,
					acknowledgementRevision,
					options.processor,
					'full',
				),
			} : {},
			result: {
				effectiveVolume,
				volumeBase: volumeBase ?? 100,
				boost: boost ?? 1,
			},
		},
		fieldAcks: options.fieldAcks ?? [],
		error: options.error ?? null,
	};
}

function speedAck(revision: number, speed: number): ControlApplyAck {
	return {
		intentId: `speed-${revision}`,
		tabId: 5,
		documentId: 'document-popup',
		generation: revision,
		revision,
		target: null,
		fields: { speed: controlField(speed, revision, 'dom-native', 'active-target') },
		audioVolume: undefined,
	};
}

function controlSnapshot(revision: number, speed: number, generation = revision): ControlSnapshot {
	return {
		tabId: 5,
		documentId: 'document-popup',
		origin: 'https://media.example',
		generation,
		revision,
		activeMedia: null,
		activeVideo: null,
		fields: { speed: controlField(speed, revision, 'dom-native', 'active-target') },
	};
}

function controlField<T>(
	value: T,
	revision: number,
	strategy: 'capture' | 'observe' | 'dom-native',
	coverage: 'full' | 'active-target',
) {
	return {
		desired: value,
		actual: value,
		revision,
		phase: 'applied' as const,
		strategy,
		coverage,
		controlled: strategy !== 'observe',
		lastError: null,
	};
}

function createState(): CardInternalState {
	return {
		config: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] },
		stableConfig: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] },
		controlSnapshot: null,
		isCaptureActive: false,
		userInteracted: false,
		actualMode: 'bypass',
		desiredMode: 'bypass',
		phase: 'idle',
		controlGeneration: 0,
		controlRevision: 0,
		audioDocumentId: null,
		audioOrigin: null,
		audioGeneration: 0,
		audioConfigRevision: 0,
		lastError: null,
		draggingField: null,
	};
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => { resolve = done; });
	return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (predicate()) return;
		await Promise.resolve();
	}
	throw new Error('Condition was not reached after flushing microtasks');
}

function restoreProperty(key: 'window', descriptor?: PropertyDescriptor): void {
	if (descriptor) Object.defineProperty(globalThis, key, descriptor);
	else Reflect.deleteProperty(globalThis, key);
}
