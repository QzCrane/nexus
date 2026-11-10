// goal: project optimistic card state while Background owns every continuous control intent

import type { AudioConfig, GlobalSettings } from '@nexus/kernel';
import {
	isActiveCaptureLifecycle,
	resolveAudioVolume,
	type ControlField,
	type ControlFieldStates,
	type ControlPatch,
} from '@nexus/contracts';
import { resolveAcknowledgedProcessorLifecycle } from '@nexus/contracts/ui-runtime';
import type { PopupControlPortResponse } from '../../shared/popup-control-port';
import { isReportedControlFailure, PopupControlChannelError, type PopupControlTransport } from './control-port';
import { mergeAudioConfig, mergeControlFields, type CardInternalState } from './types';
import { sessionBelongsToCard, updateCachedControlSnapshot } from './snapshot';
import { gestureVolumeTone } from './render';
import { classifyControlSnapshot, isControlClockStale, reconcileControlMedia } from '../control-snapshot-order';

export type ConfigUpdateFn = ((changes: Partial<AudioConfig>) => void) & {
	flush: () => Promise<void>;
	runControl: <T>(command: () => Promise<T>) => Promise<T>;
	hasPendingVolume: () => boolean;
	pendingConfigFields: () => ReadonlySet<keyof AudioConfig>;
};

export type ConfigErrorHandler = (error: unknown, state: CardInternalState) => void;

// post: applies one session snapshot. Only processor lifecycle may come from
// here; every field-level actual stays owned by the control projection.
export function applyAudioSessionSnapshot(
	tabId: number,
	state: CardInternalState,
	snapshot: import('@nexus/contracts').AudioSessionSnapshot,
	render: () => void,
	documentId?: string,
): boolean {
	if (snapshot.tabId !== tabId) return false;
	// A session for another document would describe a page this card is not
	// showing. The card's own document id is the fence when the control
	// projection has not answered yet.
	if (!sessionBelongsToCard(snapshot, state.controlSnapshot, documentId ?? '')) return false;
	const newer = snapshot.generation > state.audioGeneration
		|| (snapshot.generation === state.audioGeneration
			&& snapshot.configRevision >= state.audioConfigRevision);
	if (!newer) return false;
	state.actualMode = snapshot.actualMode;
	state.desiredMode = snapshot.desiredMode;
	state.phase = snapshot.phase;
	state.audioDocumentId = snapshot.documentId;
	state.audioOrigin = snapshot.origin;
	state.audioGeneration = snapshot.generation;
	state.audioConfigRevision = snapshot.configRevision;
	state.lastError = snapshot.lastError;
	state.lifecycleSnapshotKnown = true;
	state.isCaptureActive = isActiveCaptureLifecycle({
		actualMode: snapshot.actualMode,
		phase: snapshot.phase,
	});
	render();
	return true;
}

export function projectAcknowledgedProcessorLifecycle(
	state: CardInternalState,
	fields: ControlFieldStates,
	previousFields: ControlFieldStates = {},
): void {
	const control = state.controlSnapshot;
	const hasAudioLifecycle = state.lifecycleSnapshotKnown === true && state.audioGeneration >= 0
		&& state.audioDocumentId !== null && state.audioOrigin !== null
		&& (!control || state.audioDocumentId === control.documentId && state.audioOrigin === control.origin);
	if (hasAudioLifecycle) return;
	// A control field ACK supplies a fallback when no processor observation
	// answered. Its field revision cannot order the independent audio clock.
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
	tabId: number,
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
		if (response.audioSession) {
			applyAudioSessionSnapshot(tabId, state, response.audioSession, () => undefined,
				state.controlSnapshot?.documentId ?? response.volumeAck?.documentId
					?? response.fieldAcks[0]?.documentId ?? state.audioDocumentId ?? undefined);
		}
		const acknowledgements = [response.volumeAck, ...response.fieldAcks];
		let acceptedVolume = false;
		let volumeFieldsKnown = false;
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
			let actualFields = acknowledgement.fields;
			if (current) {
				const projected = {
					...current,
					tabId: acknowledgement.tabId,
					documentId: acknowledgement.documentId,
					generation: acknowledgement.generation,
					revision: acknowledgement.revision,
					fields: { ...current.fields, ...acknowledgement.fields },
					mediaObservation: acknowledgement.mediaObservation,
				};
				if (classifyControlSnapshot(current, projected) !== 'accepted') continue;
				const reconciled = reconcileControlMedia(current, projected);
				state.controlSnapshot = reconciled;
				actualFields = reconciled.fields;
			}
			if (acknowledgement === response.volumeAck) {
				// A no-op ACK may carry no fields. Its cached result cannot replace
				// a newer physical sample retained by the field reconciliation.
				volumeFieldsKnown = typeof actualFields.volumeBase?.actual === 'number'
					&& typeof actualFields.boost?.actual === 'number';
			}
			state.controlRevision = Math.max(state.controlRevision, acknowledgement.revision);
			state.controlGeneration = Math.max(state.controlGeneration, acknowledgement.generation);
			state.stableConfig = mergeControlFields(state.stableConfig, actualFields);
			projectAcknowledgedProcessorLifecycle(state, actualFields, current?.fields);
			acceptedAcknowledgement = true;
			if (acknowledgement === response.volumeAck) acceptedVolume = true;
		}
		// The channel's throughRevision settles the local input even when its ACK
		// is older than a page snapshot already accepted above. Keep that newer
		// truth, but retire the optimistic mask or all later page changes remain
		// hidden forever. Newer local input revisions keep their own mask.
		for (const [field, revision] of pendingFields) {
			if (revision <= response.throughRevision) pendingFields.delete(field);
		}
		if (response.volumeAck && acceptedVolume && !volumeFieldsKnown) {
			state.stableConfig = mergeAudioConfig(state.stableConfig, {
				volume: response.volumeAck.result.effectiveVolume,
				volumeBase: response.volumeAck.result.volumeBase,
				boost: response.volumeAck.result.boost,
			});
		}
		if (acceptedAcknowledgement) {
			state.controlSnapshotKnown = true;
			state.controlSyncExpired = false;
			if (state.controlSnapshot) {
				updateCachedControlSnapshot(tabId, state.controlSnapshot);
			}
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
		if (!['volume', 'volumeBase', 'boost', 'muted'].some((field) => pendingFields.has(field as keyof AudioConfig))) {
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
		const implicitUnmute = volumeChanged && nextVolume > 0 && changes.muted === undefined;
		if (implicitUnmute) next.muted = false;
		const patch = toControlPatch(changes, next);
		if (!volumeChanged && Object.keys(patch).length === 0) return;

		const inputRevision = localRevision + 1;
		const presentation = volumeChanged || changes.muted !== undefined ? {
			effectiveVolume: nextVolume,
			muted: next.muted,
			tone: gestureVolumeTone({
				volume: nextVolume, muted: next.muted, enabled: next.enabled,
				actualMode: state.actualMode, phase: state.phase, controlSnapshot: state.controlSnapshot,
			}),
		} : undefined;
		try {
			transport.stage({
				inputRevision,
				...(volumeChanged ? { effectiveVolume: nextVolume } : {}),
				...(presentation ? { tone: presentation.tone, presentationVolume: nextVolume } : {}),
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
		if (presentation) state.pendingVolumePresentation = presentation;
		if (implicitUnmute) pendingFields.set('muted', inputRevision);
		if (volumeChanged) {
			pendingFields.set('volume', inputRevision);
			pendingFields.set('volumeBase', inputRevision);
			pendingFields.set('boost', inputRevision);
		}
		state.userInteracted = true;
		delete state.hotkeyVolumePresentation;
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
