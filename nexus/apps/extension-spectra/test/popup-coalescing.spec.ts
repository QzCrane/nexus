import { afterEach, describe, expect, test } from 'bun:test';
import {
	DEFAULT_AUDIO_CONFIG,
	DEFAULT_GLOBAL_SETTINGS,
	type ControlApplyAck,
	type ControlSnapshot,
	type AudioSessionSnapshot,
} from '@nexus/contracts';
import type { PopupControlPortResponse } from '../src/shared/popup-control-port';
import { isReportedControlFailure, PopupControlChannelError, type PopupControlTransport } from '../src/popup/card/control-port';
import { applyControlSnapshot } from '../src/popup/card/messaging';
import { applyAudioSessionSnapshot } from '../src/popup/card/state';
import { resolveVolumePresentation } from '../src/popup/card/render';
import { createUpdateFn } from '../src/popup/card/state';
import type { CardInternalState } from '../src/popup/card/types';
import { COLORS } from '../src/popup/constants';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

afterEach(() => restoreProperty('window', originalWindow));

describe('Popup Background-owned control transport projection', () => {
	test('presents a channel failure once across notification, stage and flush rejection', async () => {
		const harness = installHarness();
		const state = createState();
		const errors: unknown[] = [];
		const report = (error: unknown) => {
			if (!isReportedControlFailure(error)) errors.push(error);
		};
		const update = createUpdate(harness.transport, state, report);
		const failure = new PopupControlChannelError('Background unavailable');
		harness.transport.stage = () => { harness.fail(failure); throw failure; };
		harness.onFlush(async () => { throw failure; });
		update({ speed: 1.75 });
		await update.flush().catch(report);
		expect(errors).toEqual([failure]);
		expect(state.config).toEqual(state.stableConfig);
		expect(update.pendingConfigFields().size).toBe(0);
	});
	test('retires optimistic values and reports a lost control channel', () => {
		const harness = installHarness();
		const state = createState();
		const errors: unknown[] = [];
		const update = createUpdate(harness.transport, state, (error) => errors.push(error));
		update({ volume: 110, speed: 1.5 });
		harness.fail(new Error('Background unavailable'));
		expect(update.hasPendingVolume()).toBe(false);
		expect(update.pendingConfigFields().size).toBe(0);
		expect(state.config).toEqual(state.stableConfig);
		expect(errors).toHaveLength(1);
	});
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

	test('retires a settled input when a newer page volume snapshot arrived before its ACK', () => {
		const harness = installHarness();
		const state = createState();
		state.controlSnapshot = controlSnapshot(0, 1, 1);
		state.controlGeneration = 1;
		const update = createUpdate(harness.transport, state);
		update({ volume: 40 });
		applyControlSnapshot(state, {
			...controlSnapshot(2, 1, 1),
			fields: { volumeBase: controlField(80, 2, 'dom-native', 'active-target') },
		}, () => undefined, update.hasPendingVolume(), update.pendingConfigFields());
		expect(state.stableConfig.volume).toBe(80);
		expect(state.config.volume).toBe(40);
		harness.emit(settlement(1, { volume: 40, ackGeneration: 1, ackRevision: 1 }));
		expect(update.hasPendingVolume()).toBe(false);
		expect(state.config.volume).toBe(80);
		expect(state.controlRevision).toBe(2);
	});

	test.each([false, true])('a late volume settlement cannot replace a newer page sample at the same control revision (empty ACK: %s)', (emptyAck) => {
		const harness = installHarness();
		const state = createState();
		const stamp = (revision: number) => ({ epoch: 1, owner: 'document-popup:1', selection: 1, revision });
		state.controlSnapshot = { ...controlSnapshot(1, 1, 1), mediaObservation: stamp(1) };
		state.controlGeneration = 1;
		state.controlRevision = 1;
		const update = createUpdate(harness.transport, state);
		update({ volume: 40 });
		applyControlSnapshot(state, { ...controlSnapshot(1, 1, 1), mediaObservation: stamp(3), fields: {
			volumeBase: { ...controlField(80, 1, 'dom-native', 'active-target'), mediaObservation: stamp(3) },
			boost: controlField(1, 1, 'observe', 'full'),
		} }, () => undefined, update.hasPendingVolume(), update.pendingConfigFields());
		const response = settlement(1, { volume: 40, ackGeneration: 1, ackRevision: 1 });
		if (!response.volumeAck) throw new Error('Missing volume ACK');
		response.volumeAck.mediaObservation = stamp(2);
		response.volumeAck.fields.volumeBase = { ...controlField(40, 1, 'dom-native', 'active-target'), mediaObservation: stamp(2) };
		if (emptyAck) response.volumeAck.fields = {};
		harness.emit(response);
		expect(update.hasPendingVolume()).toBe(false);
		expect(state.stableConfig.volume).toBe(80);
		expect(state.config.volume).toBe(80);
		expect(state.controlSnapshot?.fields.volumeBase?.actual).toBe(80);
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
		expect(state.config.speed).toBe(1.25);
		expect(update.pendingConfigFields().size).toBe(0);

		update({ speed: 1.5 });
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


	test('a late Capture ACK cannot replace a current stopped audio lifecycle without a prior broadcast', () => {
		const harness = installHarness();
		const state = createState();
		state.controlSnapshot = controlSnapshot(0, 1, 0);
		applyAudioSessionSnapshot(5, state, audioSession(2, 'bypass'), () => undefined);
		const update = createUpdate(harness.transport, state);
		update({ volume: 110 });
		harness.emit(settlement(1, { volume: 110, processor: 'capture' }));
		expect(state).toMatchObject({ actualMode: 'bypass', phase: 'idle', audioGeneration: 2, isCaptureActive: false });
		expect(resolveVolumePresentation(state).color).toBe(COLORS.NATIVE);
	});

	test.each(['generation', 'configRevision'] as const)('a newer stop beats a late settlement by audio %s', (clock) => {
		const harness = installHarness();
		const state = createState();
		state.controlSnapshot = controlSnapshot(0, 1, 0);
		applyAudioSessionSnapshot(5, state, audioSession(3, 'bypass', 3), () => undefined);
		const update = createUpdate(harness.transport, state);
		update({ volume: 110 });
		harness.emit({
			...settlement(1, { volume: 110, processor: 'capture' }),
			audioSession: audioSession(clock === 'generation' ? 2 : 3, 'capture', 2),
		});
		expect(state).toMatchObject({ actualMode: 'bypass', phase: 'idle', audioGeneration: 3, isCaptureActive: false });
	});

	test('fresh first-Capture lifecycle is applied before pending presentation is removed', () => {
		const harness = installHarness();
		const state = createState();
		state.controlSnapshot = controlSnapshot(0, 1, 0);
		applyAudioSessionSnapshot(5, state, audioSession(0, 'bypass'), () => undefined);
		const frames: string[] = [];
		const update = createUpdate(harness.transport, state, () => undefined,
			() => { frames.push(resolveVolumePresentation(state).color); });
		update({ volume: 110 });
		frames.length = 0;
		harness.emit({
			...settlement(1, { volume: 110, processor: 'capture' }),
			audioSession: audioSession(1, 'capture'),
		});
		expect(frames).toEqual([COLORS.CAPTURE]);
		expect(state).toMatchObject({ actualMode: 'capture', phase: 'active', audioGeneration: 1, isCaptureActive: true });
		expect(state.pendingVolumePresentation).toBeUndefined();
	});

	test('does not replay a broadcast Capture field when its settlement arrives after a session stop', () => {
		const harness = installHarness();
		const state = createState();
		state.controlSnapshot = controlSnapshot(0, 1, 0);
		const update = createUpdate(harness.transport, state);
		update({ volume: 110 });
		const captured = settlement(1, { volume: 110, processor: 'capture' });
		if (!captured.volumeAck) throw new Error('Expected volume acknowledgement');
		applyControlSnapshot(state, {
			...controlSnapshot(1, 1, 1),
			fields: captured.volumeAck.fields,
		}, () => undefined);
		expect(state.actualMode).toBe('capture');
		// Broadcast and Port settlement are separate deliveries of one field ACK.
		// A current-document session stop can arrive between them.
		state.actualMode = 'bypass';
		state.phase = 'idle';
		state.isCaptureActive = false;
		harness.emit(captured);
		expect(state.actualMode).toBe('bypass');
		expect(resolveVolumePresentation(state).color).toBe(COLORS.NATIVE);
	});

	test('paints planned Capture on the first gesture frame and publishes the identical badge tone', () => {
		const harness = installHarness();
		const state = createState();
		state.controlSnapshot = { ...controlSnapshot(1, 1, 1), prospectiveBoostRoute: 'capture' };
		const frames: Array<{ effectiveVolume: number; color: string }> = [];
		const update = createUpdate(harness.transport, state, () => undefined, () => {
			frames.push(resolveVolumePresentation(state));
		});

		update({ volume: 110 });
		expect(state.config.volume).toBe(110);
		expect(frames.at(-1)).toEqual({ effectiveVolume: 110, color: COLORS.CAPTURE });
		expect(harness.stages.at(-1)?.tone).toBe('capture');
		harness.emit(settlement(1, { volume: 110, processor: 'capture' }));
		expect(frames.at(-1)).toEqual({ effectiveVolume: 110, color: COLORS.CAPTURE });

		update({ volume: 100 });
		expect(state.config.volume).toBe(100);
		// Leaving the Boost range predicts a passthrough split, so the same gesture
		// frame that shows 100 is already blue; it must not wait for the release.
		expect(frames.at(-1)).toEqual({ effectiveVolume: 100, color: COLORS.NATIVE });
		harness.emit(settlement(2, { volume: 100, processor: 'observe' }));
		expect(frames.at(-1)).toEqual({ effectiveVolume: 100, color: COLORS.NATIVE });
	});

	test('keeps a coherent visible result through superseded volume and lifecycle acknowledgements', () => {
		const harness = installHarness();
		const state = createState();
		const update = createUpdate(harness.transport, state);
		update({ volume: 110 });
		update({ volume: 50 });
		state.actualMode = 'capture';
		state.phase = 'active';
		harness.emit(settlement(1, { volume: 110, processor: 'capture' }));
		expect(state.config.volume).toBe(50);
		expect(resolveVolumePresentation(state)).toEqual({ effectiveVolume: 50, color: COLORS.NATIVE });
		harness.emit(settlement(2, { volume: 50, processor: 'observe' }));
		expect(resolveVolumePresentation(state)).toEqual({ effectiveVolume: 50, color: COLORS.NATIVE });
		expect(state.pendingVolumePresentation).toBeUndefined();
	});

	test('releases the pending result on channel failure and keeps native amplification blue', () => {
		const harness = installHarness();
		const state = createState();
		const update = createUpdate(harness.transport, state);
		update({ volume: 130 });
		harness.emit(settlement(1, { volume: 130, processor: 'observe' }));
		expect(resolveVolumePresentation(state)).toEqual({ effectiveVolume: 130, color: COLORS.NATIVE });
		update({ volume: 350 });
		harness.fail(new Error('Channel disconnected'));
		expect(state.pendingVolumePresentation).toBeUndefined();
		expect(resolveVolumePresentation(state)).toEqual({ effectiveVolume: 130, color: COLORS.NATIVE });
	});

	test('a positive volume gesture presents its implicit unmute in the same planned Capture frame', () => {
		const harness = installHarness();
		const state = createState();
		state.config.muted = true;
		state.stableConfig.muted = true;
		state.controlSnapshot = { ...controlSnapshot(1, 1, 1), prospectiveBoostRoute: 'capture' };
		const update = createUpdate(harness.transport, state);
		update({ volume: 110 });
		expect(state.config.muted).toBe(false);
		expect(state.pendingVolumePresentation?.muted).toBe(false);
		expect(harness.stages.at(-1)).toMatchObject({ effectiveVolume: 110, presentationVolume: 110, tone: 'capture' });
		expect(resolveVolumePresentation(state).color).toBe(COLORS.CAPTURE);
		harness.fail(new Error('writer unavailable'));
		expect(state.config.muted).toBe(true);
		expect(resolveVolumePresentation(state).color).toBe(COLORS.MUTED);
	});

	test('keeps preset volume and mute presentation together until their batch settles', () => {
		const harness = installHarness();
		const state = createState();
		const update = createUpdate(harness.transport, state);
		update({ volume: 110, muted: true });
		expect(state.config.muted).toBe(true);
		expect(state.pendingVolumePresentation?.muted).toBe(true);
		expect(harness.stages.at(-1)?.tone).toBe('muted');
		expect(resolveVolumePresentation(state)).toEqual({ effectiveVolume: 110, color: COLORS.MUTED });
		harness.emit(settlement(1, {
			volume: 110,
			processor: 'capture',
			fieldAcks: [{ ...speedAck(1, 1), fields: { mediaMuted: controlField(true, 1, 'dom-native', 'active-target') } }],
		}));
		expect(state.pendingVolumePresentation).toBeUndefined();
		expect(resolveVolumePresentation(state)).toEqual({ effectiveVolume: 110, color: COLORS.MUTED });
	});

	test('renders a same-route drag live instead of freezing at the drag-start value', () => {
		const harness = installHarness();
		const state = createState();
		const frames: number[] = [];
		const update = createUpdate(harness.transport, state, () => undefined, () => {
			frames.push(resolveVolumePresentation(state).effectiveVolume);
		});

		// Both the numeric value and its planned tone follow the current input.
		update({ volume: 40 });
		harness.emit(settlement(1, { volume: 40, processor: 'observe' }));
		expect(state.pendingVolumePresentation).toBeUndefined();

		update({ volume: 70 });
		expect(state.pendingVolumePresentation?.tone).toBe('native');
		expect(frames.at(-1)).toBe(70);
		expect(resolveVolumePresentation(state).effectiveVolume).toBe(70);

		// Crossing does not freeze the number or retain an unrelated old tone.
		update({ volume: 110 });
		expect(state.pendingVolumePresentation).toBeDefined();
		expect(resolveVolumePresentation(state).effectiveVolume).toBe(110);
		expect(resolveVolumePresentation(state).color).toBe(COLORS.NATIVE);
	});

	test('a drag that crosses the 100 boundary still tracks the thumb every step', () => {
		const harness = installHarness();
		const state = createState();
		const update = createUpdate(harness.transport, state, () => undefined);
		update({ volume: 40 });
		harness.emit(settlement(1, { volume: 40, processor: 'observe' }));

		// A boundary crossing must not freeze the bar or readout at drag start.
		for (const volume of [90, 110, 240, 480, 700]) {
			update({ volume });
			expect(resolveVolumePresentation(state).effectiveVolume).toBe(volume);
		}
		expect(state.pendingVolumePresentation).toBeDefined();
		expect(resolveVolumePresentation(state).color).toBe(COLORS.NATIVE);
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
	const failures = new Set<(error: Error) => void>();
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
		fail(error: Error) {
			for (const listener of failures) listener(error);
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
			onFailure(listener) {
				failures.add(listener);
				return () => failures.delete(listener);
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

function audioSession(generation: number, actualMode: 'capture' | 'bypass', configRevision = 1): AudioSessionSnapshot {
	return {
		tabId: 5, documentId: 'document-popup', origin: 'https://media.example',
		generation, configRevision, desiredMode: actualMode, actualMode,
		phase: actualMode === 'capture' ? 'active' : 'idle',
		actualConfig: { ...DEFAULT_AUDIO_CONFIG, eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues] },
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
