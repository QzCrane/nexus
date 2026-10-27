// goal: project optimistic card state while Background owns every continuous control intent

import type { AudioConfig, GlobalSettings } from '@nexus/kernel';
import {
	isActiveCaptureLifecycle,
	resolveAudioVolume,
	shouldHoldVolumeTone,
	type ControlField,
	type ControlFieldStates,
	type ControlPatch,
} from '@nexus/contracts';
import { resolveAcknowledgedProcessorLifecycle } from '@nexus/contracts/ui-runtime';
import type { PopupControlPortResponse } from '../../shared/popup-control-port';
import { isReportedControlFailure, PopupControlChannelError, type PopupControlTransport } from './control-port';
import { mergeAudioConfig, mergeControlFields, type CardInternalState } from './types';
import { classifyControlSnapshot, isControlClockStale } from '../control-snapshot-order';

export type ConfigUpdateFn = ((changes: Partial<AudioConfig>) => void) & {
	flush: () => Promise<void>;
	runControl: <T>(command: () => Promise<T>) => Promise<T>;
	hasPendingVolume: () => boolean;
	pendingConfigFields: () => ReadonlySet<keyof AudioConfig>;
};

export type ConfigErrorHandler = (error: unknown, state: CardInternalState) => void;

export function projectAcknowledgedProcessorLifecycle(
	state: CardInternalState,
	fields: ControlFieldStates,
	previousFields: ControlFieldStates = {},
): void {
	// Snapshots carry unchanged field ACKs. Only newly acknowledged processor
	// fields may supersede the lifecycle already observed for this document.
	const advanced = Object.fromEntries(Object.entries(fields).filter(([field, value]) => (
		value !== undefined
		&& value.revision > (previousFields[field as ControlField]?.revision ?? -1)
	))) as ControlFieldStates;
	const lifecycle = resolveAcknowledgedProcessorLifecycle(advanced);
	if (!lifecycle) return;
	state.actualMode = lifecycle.actualMode;
	state.desiredMode = lifecycle.actualMode;
	state.phase = lifecycle.phase;
	state.isCaptureActive = lifecycle.actualMode === 'capture';
}

export function createGetCapturing(state: CardInternalState): () => boolean {
	return () => isActiveCaptureLifecycle({ actualMode: state.actualMode, phase: state.phase });
}

function toControlPatch(changes: Partial<AudioConfig>, config: AudioConfig): ControlPatch {
	const patch: ControlPatch = {};
	if (changes.enabled !== undefined) patch.audioEnabled = config.enabled;
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
}

function splitByCoverage(patch: ControlPatch): Array<{
	requestedCoverage: 'active-target' | 'full';
	patch: ControlPatch;
}> {
	const target: ControlPatch = {};
	const full: ControlPatch = {};
	for (const [field, value] of Object.entries(patch)) {
		const output = ['audioEnabled', 'boost', 'eqValues', 'bass', 'compressor', 'mono', 'pan', 'delay'].includes(field)
			? full
			: target;
		(output as Record<string, unknown>)[field] = value;
	}
	return [
		...(Object.keys(target).length > 0
			? [{ requestedCoverage: 'active-target' as const, patch: target }]
			: []),
		...(Object.keys(full).length > 0
			? [{ requestedCoverage: 'full' as const, patch: full }]
			: []),
	];
}

export function createUpdateFn(
	state: CardInternalState,
	_tabId: number,
	_getCapturing: () => boolean,
	render: () => void,
	_getGlobalSettings: () => GlobalSettings,
	onError: ConfigErrorHandler = () => undefined,
	transport: PopupControlTransport,
): ConfigUpdateFn {
	let localRevision = 0;
	let retired = false;
	let controlTail: Promise<void> = Promise.resolve();
	const pendingFields = new Map<keyof AudioConfig, number>();

	const applySettlement = (response: PopupControlPortResponse): void => {
		const optimisticBeforeSettlement = state.config;
		const acknowledgements = [response.volumeAck, ...response.fieldAcks];
		let acceptedVolume = false;
		let acceptedAcknowledgement = false;
		for (const acknowledgement of acknowledgements) {
			if (!acknowledgement) continue;
			if (isControlClockStale(
				state.controlGeneration,
				state.controlRevision,
				acknowledgement.generation,
				acknowledgement.revision,
			)) continue;
			const current = state.controlSnapshot;
			if (current) {
				const projected = {
					...current,
					tabId: acknowledgement.tabId,
					documentId: acknowledgement.documentId,
					generation: acknowledgement.generation,
					revision: acknowledgement.revision,
					fields: { ...current.fields, ...acknowledgement.fields },
				};
				if (classifyControlSnapshot(current, projected) !== 'accepted') continue;
				state.controlSnapshot = projected;
			}
			state.controlRevision = Math.max(state.controlRevision, acknowledgement.revision);
			state.controlGeneration = Math.max(state.controlGeneration, acknowledgement.generation);
			state.stableConfig = mergeControlFields(state.stableConfig, acknowledgement.fields);
			projectAcknowledgedProcessorLifecycle(state, acknowledgement.fields, current?.fields);
			acceptedAcknowledgement = true;
			if (acknowledgement === response.volumeAck) acceptedVolume = true;
		}
		if (acceptedAcknowledgement || response.error) {
			for (const [field, revision] of pendingFields) {
				if (revision <= response.throughRevision) pendingFields.delete(field);
			}
		}
		if (response.volumeAck && acceptedVolume) {
			state.stableConfig = mergeAudioConfig(state.stableConfig, {
				volume: response.volumeAck.result.effectiveVolume,
				volumeBase: response.volumeAck.result.volumeBase,
				boost: response.volumeAck.result.boost,
			});
		}
		if (acceptedAcknowledgement) {
			state.controlSnapshotKnown = true;
		}
		state.lastError = response.error;
		state.config = mergeAudioConfig(state.stableConfig, {
			eqValues: [...state.stableConfig.eqValues],
		});
		const projected = state.config as unknown as Record<string, unknown>;
		const optimistic = optimisticBeforeSettlement as unknown as Record<string, unknown>;
		for (const field of pendingFields.keys()) {
			projected[field] = optimistic[field];
		}
		if (!['volume', 'volumeBase', 'boost'].some((field) => pendingFields.has(field as keyof AudioConfig))) {
			delete state.pendingVolumePresentation;
		}
		render();
		if (response.error) onError(new Error(response.error.message), state);
	};

	transport.onSettled(applySettlement);
	transport.onFailure((error) => {
		if (retired) return;
		pendingFields.clear();
		delete state.pendingVolumePresentation;
		state.config = mergeAudioConfig(state.stableConfig, { eqValues: [...state.stableConfig.eqValues] });
		render();
		onError(error, state);
		if (error instanceof PopupControlChannelError) error.reported = true;
	});
	window.addEventListener('pagehide', () => { retired = true; }, { once: true });

	const flush = async (): Promise<void> => {
		const response = await transport.flush(localRevision);
		if (response?.error) throw new Error(response.error.message);
	};

	const serializeControl = <T>(command: () => Promise<T>): Promise<T> => {
		const result = controlTail.then(command, command);
		controlTail = result.then(() => undefined, () => undefined);
		return result;
	};

	const runControl = async <T>(command: () => Promise<T>): Promise<T> => {
		return serializeControl(async () => {
			await flush();
			if (retired) throw new Error('Popup retired before the control command was dispatched');
			return command();
		});
	};

	const update = ((changes: Partial<AudioConfig>) => {
		if (retired) return;
		const previous = state.config;
		const next = mergeAudioConfig(previous, changes);
		const hasVolumeChange = changes.volume !== undefined
			|| changes.volumeBase !== undefined
			|| changes.boost !== undefined;
		const previousVolume = resolveAudioVolume(previous).effectiveVolume;
		const nextVolume = resolveAudioVolume(next).effectiveVolume;
		const volumeChanged = hasVolumeChange && previousVolume !== nextVolume;
		const patch = toControlPatch(changes, next);
		if (!volumeChanged && Object.keys(patch).length === 0) return;

		const inputRevision = localRevision + 1;
		try {
			transport.stage({
				inputRevision,
				...(volumeChanged ? { effectiveVolume: nextVolume } : {}),
				groups: splitByCoverage(patch),
			});
		} catch (error) {
			if (!isReportedControlFailure(error)) onError(error, state);
			return;
		}
		localRevision = inputRevision;
		for (const rawField of Object.keys(changes)) {
			pendingFields.set(rawField as keyof AudioConfig, inputRevision);
		}
		if (volumeChanged) {
			// Only the tone is held, and only while the route may actually change.
			// The contract owns the boundary and the mute case so this call site
			// cannot drift from the documented rule again.
			if (shouldHoldVolumeTone({
				previousEffectiveVolume: previousVolume,
				nextEffectiveVolume: nextVolume,
				mutedChanged: changes.muted !== undefined,
			})) {
				state.pendingVolumePresentation ??= {
					effectiveVolume: previousVolume,
					muted: previous.muted,
					actualMode: state.actualMode,
					phase: state.phase,
				};
			}
			pendingFields.set('volume', inputRevision);
			pendingFields.set('volumeBase', inputRevision);
			pendingFields.set('boost', inputRevision);
		}
		state.userInteracted = true;
		state.config = next;
		render();
	}) as ConfigUpdateFn;
	update.flush = flush;
	update.runControl = runControl;
	update.hasPendingVolume = () => ['volume', 'volumeBase', 'boost']
		.some((field) => pendingFields.has(field as keyof AudioConfig));
	update.pendingConfigFields = () => new Set(pendingFields.keys());
	return update;
}
