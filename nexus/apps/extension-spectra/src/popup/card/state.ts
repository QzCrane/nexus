// goal: manages the internal state of a tab control card and orchestrates configuration updates across background and content scripts

import type { AudioConfig, GlobalSettings } from '@nexus/kernel';
import {
	isActiveCaptureLifecycle,
	resolveAudioVolume,
	resolveAudioVolumeState,
	crossesAudioVolumeRoutingBoundary,
	type ControlOperationAck,
	type ControlFieldStates,
	type ControlPatch,
} from '@nexus/contracts';
import { resolveAcknowledgedProcessorLifecycle } from '@nexus/contracts/ui-runtime';
import { mergeAudioConfig, mergeControlFields, type CardInternalState } from './types';
import { sendSpectraRequest } from '../../shared/ui-spectra-client';
import { submitControlIntent, submitControlOperation } from './intent-recovery';

export type ConfigUpdateFn = ((changes: Partial<AudioConfig>) => void) & {
	flush: () => Promise<void>;
	runControl: <T>(command: () => Promise<T>) => Promise<T>;
};

export type ConfigErrorHandler = (
	error: unknown,
	state: CardInternalState,
) => void;

// Processor field ACKs prove the lifecycle that produced their readback.
// Project active Capture and neutral release symmetrically so
// Popup rendering cannot lag behind the compound ACK's actual result.
export function projectAcknowledgedProcessorLifecycle(
	state: CardInternalState,
	fields: ControlFieldStates,
): void {
	const lifecycle = resolveAcknowledgedProcessorLifecycle(fields);
	if (!lifecycle) return;
	state.actualMode = lifecycle.actualMode;
	state.desiredMode = lifecycle.actualMode;
	state.phase = lifecycle.phase;
	state.isCaptureActive = lifecycle.actualMode === 'capture';
}

export function createGetCapturing(
  state: CardInternalState,
): () => boolean {
  return () => isActiveCaptureLifecycle({
	actualMode: state.actualMode,
	phase: state.phase,
  });
}

// post: returns an async update function that applies changes optimistically and routes commands based on the active capture mode
export function createUpdateFn(
  state: CardInternalState,
	tabId: number,
	_getCapturing: () => boolean,
	render: () => void,
	_getGlobalSettings: () => GlobalSettings,
	onError: ConfigErrorHandler = () => undefined,
): ConfigUpdateFn {
	const minSendIntervalMs = 50;
	let pending = false;
	let inFlight: Promise<void> | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let lastSentAt = 0;
	let localRevision = 0;
	let pendingPatch: ControlPatch = {};
	let pendingEffectiveVolume: number | null = null;
	let desiredConfig = state.config;
	let controlTail: Promise<void> = Promise.resolve();

	const serializeControl = <T>(command: () => Promise<T>): Promise<T> => {
		const result = controlTail.then(command, command);
		controlTail = result.then(() => undefined, () => undefined);
		return result;
	};

	const toControlPatch = (
		changes: Partial<AudioConfig>,
		config: AudioConfig = state.config,
	): ControlPatch => {
		const patch: ControlPatch = {};
		if (changes.enabled !== undefined) patch.audioEnabled = config.enabled;
		// The public 0-800 control is submitted as one compound operation below.
		// Never duplicate its split native/processor fields into ordinary patches.
		if (changes.muted !== undefined) patch.mediaMuted = config.muted;
		if (changes.speed !== undefined) patch.speed = config.speed;
		if (changes.preservePitch !== undefined) patch.preservePitch = config.preservePitch;
		if (changes.eqValues !== undefined) patch.eqValues = [...config.eqValues];
		if (changes.bass !== undefined) patch.bass = config.bass;
		if (changes.compressor !== undefined) patch.compressor = config.compressor;
		if (changes.mono !== undefined) patch.mono = config.mono;
		if (changes.pan !== undefined) patch.pan = config.pan;
		if (changes.delay !== undefined) patch.delay = config.delay;
		return patch;
	};

	const splitByCoverage = (patch: ControlPatch): Array<{
		requestedCoverage: 'active-target' | 'full';
		patch: ControlPatch;
	}> => {
		const target: ControlPatch = {};
		const full: ControlPatch = {};
		for (const [field, value] of Object.entries(patch)) {
			const output = ['audioEnabled', 'boost', 'eqValues', 'bass', 'compressor', 'mono', 'pan', 'delay'].includes(field)
				? full
				: target;
			(output as Record<string, unknown>)[field] = value;
		}
		return [
			...(Object.keys(target).length > 0 ? [{ requestedCoverage: 'active-target' as const, patch: target }] : []),
			...(Object.keys(full).length > 0 ? [{ requestedCoverage: 'full' as const, patch: full }] : []),
		];
	};

	const scheduleFlush = () => {
		if (timer || inFlight) return;
		const delay = Math.max(0, minSendIntervalMs - (performance.now() - lastSentAt));
	timer = setTimeout(() => {
			timer = null;
			void flush().catch((error: unknown) => onError(error, state));
		}, delay);
	};

	const flush = (): Promise<void> => {
		if (inFlight) return inFlight;
		if (!pending) return Promise.resolve();
		pending = false;
		lastSentAt = performance.now();
		const sentRevision = localRevision;
		const patch = pendingPatch;
		const effectiveVolume = pendingEffectiveVolume;
		pendingPatch = {};
		pendingEffectiveVolume = null;
		const requeuePatch = (remaining: ControlPatch): void => {
			if (Object.keys(remaining).length === 0) return;
			// A failed stage must not consume an independent field intent.  Preserve
			// newer values already queued while putting the unsent fields back at the
			// front of the next flush.
			pendingPatch = { ...remaining, ...pendingPatch };
			pending = true;
		};

		inFlight = serializeControl(async () => {
			if (effectiveVolume !== null) {
				try {
					const response = await submitControlOperation(
						{ tabId, state, render },
						{ operation: 'effective-volume', payload: { operation: 'set', value: effectiveVolume } },
					);
					if (!response.ok) {
						state.lastError = response.error;
						throw new Error(response.error.message);
					}
					const acknowledgement = response.data as ControlOperationAck<'effective-volume'>;
					state.controlRevision = Math.max(state.controlRevision, acknowledgement.revision);
					state.controlGeneration = Math.max(state.controlGeneration, acknowledgement.generation);
					state.stableConfig = mergeControlFields(state.stableConfig, acknowledgement.fields);
					projectAcknowledgedProcessorLifecycle(state, acknowledgement.fields);
					state.stableConfig = mergeAudioConfig(state.stableConfig, {
						volume: acknowledgement.result.effectiveVolume,
						volumeBase: acknowledgement.result.volumeBase,
						boost: acknowledgement.result.boost,
					});
				} catch (error) {
					// Volume and ordinary DSP are independent intents.  Requeue the
					// latter when the compound volume operation fails.
					requeuePatch(patch);
					throw error;
				}
			}
			const groups = splitByCoverage(patch);
			for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
				const group = groups[groupIndex];
				if (!group) continue;
				try {
					const response = await submitControlIntent(
						{ tabId, state, render },
						{ requestedCoverage: group.requestedCoverage, patch: group.patch },
					);
					if (!response.ok) {
						state.lastError = response.error;
						throw new Error(response.error.message);
					}
					state.controlRevision = Math.max(state.controlRevision, response.data.revision);
					state.controlGeneration = Math.max(
						state.controlGeneration,
						response.data.generation,
					);
					const applied = Object.values(response.data.fields);
					const failed = applied.find((field) => field?.lastError)?.lastError ?? null;
					if (failed) {
						state.lastError = failed;
						throw new Error(failed.message);
					}
					state.stableConfig = mergeControlFields(state.stableConfig, response.data.fields);
					projectAcknowledgedProcessorLifecycle(state, response.data.fields);
				} catch (error) {
					const unsent: ControlPatch = {};
					for (const next of groups.slice(groupIndex)) Object.assign(unsent, next.patch);
					// Preserve the rejected group as well as later groups. The ACK-driven
					// state has rolled back this intent, so a later explicit update must
					// not silently erase the user's failed DSP fields.
					requeuePatch(unsent);
					throw error;
				}
			}
			// A response for an earlier drag sample must not overwrite a newer
			// optimistic value that is waiting to be coalesced and sent.
			if (localRevision === sentRevision) {
				state.config = mergeAudioConfig(state.stableConfig, {
					eqValues: [...state.stableConfig.eqValues],
				});
				desiredConfig = state.config;
				state.volumeTransitionPresentation = undefined;
			}
			// A committed ACK is authoritative field-level truth. Flip the
			// transient-unknown latch so the card projection and diagnostics
			// recover even when the bootstrap read never settled.
			state.controlSnapshotKnown = true;
			state.lastError = null;
		}).catch((error: unknown) => {
			if (localRevision === sentRevision) {
				state.config = mergeAudioConfig(state.stableConfig, {
					eqValues: [...state.stableConfig.eqValues],
				});
				desiredConfig = state.config;
				state.volumeTransitionPresentation = undefined;
			}
			throw error;
		}).finally(() => {
			inFlight = null;
			render();
			// A failed intent is requeued for an explicit subsequent user update;
			// do not spin an automatic retry loop on a persistent coordinator error.
			if (pending && localRevision !== sentRevision) scheduleFlush();
		});
		return inFlight;
	};

	const drain = async (): Promise<void> => {
		while (true) {
			while (pending || inFlight) {
				if (inFlight) await inFlight;
				else {
					if (timer) {
						clearTimeout(timer);
						timer = null;
					}
					await flush();
				}
			}
			await controlTail;
			if (!pending && !inFlight) return;
		}
	};

	const runControl = async <T>(command: () => Promise<T>): Promise<T> => {
		// The coordinator is the sole authority for an unknown control state.
		// Routing an intent even without a local snapshot lets the coordinator
		// serve or reject with a typed error (e.g. stale-revision recovery),
		// so a transient bootstrap miss never dead-ends the card controls.
		await drain();
		return serializeControl(command);
	};

	window.addEventListener('pagehide', () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		void drain()
			.then(() => sendSpectraRequest('spectra.audio.session.flush', {}, { tabId }))
			.catch(() => undefined);
	}, { once: true });

	const update = ((changes: Partial<AudioConfig>) => {
		// This function is only invoked by explicit controls/preset actions; reads never call it.
		const previous = pending || inFlight ? desiredConfig : state.config;
		const next = mergeAudioConfig(previous, changes);
		desiredConfig = next;
		const hasVolumeChange = changes.volume !== undefined
			|| changes.volumeBase !== undefined
			|| changes.boost !== undefined;
		const previousVolume = resolveAudioVolume(previous).effectiveVolume;
		const nextVolume = resolveAudioVolume(next).effectiveVolume;
		const volumeChanged = hasVolumeChange && previousVolume !== nextVolume;
		const patch = toControlPatch(changes, next);
		// Identical range-input samples are discarded before the runtime boundary.
		// This keeps repeated values at zero IPC and zero persistence work.
		if (!volumeChanged && Object.keys(patch).length === 0) return;
		state.userInteracted = true;

		// A boundary crossing keeps only the last acknowledged processor colour.
		// The public value remains optimistic, otherwise a responsive native 100→110
		// page controller appears frozen while the route ACK is being stabilized.
		const stableVolume = resolveAudioVolume(state.stableConfig).effectiveVolume;
		const crossesRoutingBoundary = volumeChanged
			&& crossesAudioVolumeRoutingBoundary(stableVolume, nextVolume);
		if (crossesRoutingBoundary && !state.volumeTransitionPresentation) {
			const effectiveVolume = resolveAudioVolume(state.config).effectiveVolume;
			state.volumeTransitionPresentation = {
				effectiveVolume,
				volumeState: resolveAudioVolumeState({
					volume: effectiveVolume,
					muted: state.config.muted,
					actualMode: state.actualMode,
					phase: state.phase,
				}),
			};
		}
		state.config = next;
		if (volumeChanged) pendingEffectiveVolume = nextVolume;
		pendingPatch = { ...pendingPatch, ...patch };
		localRevision += 1;
		pending = true;
		render();
		scheduleFlush();
	}) as ConfigUpdateFn;
	update.flush = drain;
	update.runControl = runControl;
	return update;
}
