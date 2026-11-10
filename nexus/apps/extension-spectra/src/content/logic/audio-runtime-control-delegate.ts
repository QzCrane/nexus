// goal: bridge full-output coordinator fields to one acknowledged audio policy runtime

import {
	resolveAudioVolume,
	resolveDesiredAudioMode,
	CONTROL_VALUE_LIMITS,
	type VolumeBoostRoute,
	resolveBoostRoute,
	compileEffectiveVolume,
	resolveAudioVolumeState,
	requiresAudioProcessor,
	type ControlActualContext,
	type ControlDirectField,
	type ControlField,
	type ControlFieldStates,
	type ControlIntent,
	type ControlObservationStrategies,
	type ControlPatch,
	type ControlStrategy,
	type ControlValues,
} from '@nexus/contracts';
import type { PolicyExecutor } from './policy-executor';
import { CAPTURE_ADMISSION_REQUIRED } from './mode-executor';
import type { PolicyExecutorState } from '../types';
import type { AudioRuntimeControlDelegate, AudioRuntimeReadResult } from './native-media-executor';
import type { FullscreenAudioHandoff } from '../core/fullscreen-audio-handoff';

const AUDIO_RUNTIME_CONTROL_FIELDS = new Set<ControlDirectField>([
	'audioEnabled',
	'boost',
	'eqValues',
	'bass',
	'compressor',
	'mono',
	'pan',
	'delay',
]);

const DOCUMENT_OUTPUT_FIELDS = new Set<ControlDirectField>(['volumeBase', 'mediaMuted']);

function documentOutputAcknowledged(state: PolicyExecutorState): boolean {
	return documentOutputActive(state)
		&& state.config.volumeBase === state.appliedConfig.volumeBase
		&& state.config.boost === state.appliedConfig.boost
		&& state.config.muted === state.appliedConfig.muted;
}

function documentOutputActive(state: PolicyExecutorState): boolean {
	return state.actualMode === 'capture' && state.phase === 'active'
		&& state.appliedConfig.documentOutput === true;
}

function actualAudioEnabled(state: PolicyExecutorState): boolean {
	if (!state.config.enabled) return false;
	if (state.config.documentOutput === true && !documentOutputAcknowledged(state)) return false;
	if (!requiresAudioProcessor(state.config)) return true;
	return (state.actualMode === 'webaudio' || state.actualMode === 'capture')
		&& state.phase === 'active'
		&& resolveAudioVolume(state.config).boost === resolveAudioVolume(state.appliedConfig).boost
		&& state.config.eqValues.every((value, index) => value === state.appliedConfig.eqValues[index])
		&& state.config.bass === state.appliedConfig.bass
		&& state.config.compressor === state.appliedConfig.compressor
		&& state.config.mono === state.appliedConfig.mono
		&& state.config.pan === state.appliedConfig.pan
		&& state.config.delay === state.appliedConfig.delay;
}

// A pure candidate query reuses the policy's own decision. Unknown coverage
// cannot be silently turned into proof that the page needs Capture.
function prospectiveVolumeBoostRoute(state: Pick<PolicyExecutorState, 'config' | 'mediaRoute' | 'mediaWebAudio'>): VolumeBoostRoute {
	if (state.mediaWebAudio === undefined && state.mediaRoute !== 'direct' && state.mediaRoute !== 'capture') return null;
	const boost = CONTROL_VALUE_LIMITS.boost.max;
	const volumeBase = CONTROL_VALUE_LIMITS.volumeBase.max;
	const mode = resolveDesiredAudioMode({ ...state.config, volumeBase, boost, volume: compileEffectiveVolume(volumeBase, boost) }, {
		visualizer: false, mediaRoute: state.mediaRoute, mediaWebAudio: state.mediaWebAudio ?? false,
	});
	return mode === 'capture' ? 'capture' : mode === 'webaudio' ? 'media-webaudio' : null;
}

export function createAudioRuntimeControlDelegate(
	policyExecutor: PolicyExecutor,
	state: PolicyExecutorState,
	fullscreenHandoff?: Pick<FullscreenAudioHandoff, 'run'>,
): AudioRuntimeControlDelegate {
	const synchronizeNative = (context: ControlActualContext): void => {
		const documentOutput = state.config.documentOutput === true || state.appliedConfig.documentOutput === true;
		if (!documentOutput && typeof context.volumeBase === 'number') {
			const desiredBoost = resolveAudioVolume(state.config).boost;
			const appliedBoost = resolveAudioVolume(state.appliedConfig).boost;
			state.config.volumeBase = context.volumeBase;
			state.config.volume = Math.round(context.volumeBase * desiredBoost * 100) / 100;
			state.appliedConfig.volumeBase = context.volumeBase;
			state.appliedConfig.volume = Math.round(context.volumeBase * appliedBoost * 100) / 100;
		}
		if (!documentOutput && typeof context.mediaMuted === 'boolean') {
			state.config.muted = context.mediaMuted;
			state.appliedConfig.muted = context.mediaMuted;
		}
		if (typeof context.speed === 'number') {
			state.config.speed = context.speed;
			state.appliedConfig.speed = context.speed;
		}
		if (typeof context.preservePitch === 'boolean') {
			state.config.preservePitch = context.preservePitch;
			state.appliedConfig.preservePitch = context.preservePitch;
		}
	};
	const read = (fields: readonly ControlField[]): AudioRuntimeReadResult => {
		const applied = state.appliedConfig;
		const patch: ControlPatch = {};
		const observedStrategies: ControlObservationStrategies = {};
		// Capture owns the same fields as the WebAudio graph when it is the active
		// path; naming the path here keeps Background from re-deciding it.
		const processorStrategy = state.actualMode === 'capture' ? 'capture' : 'media-webaudio';
		for (const field of fields) {
			let actual: unknown;
			switch (field) {
				case 'volumeBase': if (documentOutputActive(state)) actual = applied.volumeBase; break;
				case 'mediaMuted': if (documentOutputActive(state)) actual = applied.muted; break;
				case 'audioEnabled': actual = actualAudioEnabled(state); break;
				case 'boost': actual = resolveAudioVolume(applied).boost; break;
				case 'eqValues': actual = [...applied.eqValues]; break;
				case 'bass': actual = applied.bass; break;
				case 'compressor': actual = applied.compressor; break;
				case 'mono': actual = applied.mono; break;
				case 'pan': actual = applied.pan; break;
				case 'delay': actual = applied.delay; break;
			}
			if (actual !== undefined) {
				(patch as Record<string, unknown>)[field] = actual;
				observedStrategies[field as ControlDirectField] = field === 'audioEnabled'
					? 'extension-state'
					: DOCUMENT_OUTPUT_FIELDS.has(field as ControlDirectField) ? 'capture' : processorStrategy;
			}
		}
		return { patch, observedStrategies,
			...(fields.includes('volumeBase') ? { prospectiveBoostRoute: prospectiveVolumeBoostRoute(state) } : {}),
		};
	};
	const apply = async (intent: ControlIntent, patch: ControlPatch, documentOutput = false): Promise<ControlFieldStates> => {
		const releaseOutput = intent.releaseDocumentOutput === true;
		const outputRequested = !releaseOutput && (documentOutput || state.config.documentOutput === true);
		const isRuntimeField = (field: string): field is ControlDirectField => AUDIO_RUNTIME_CONTROL_FIELDS.has(field as ControlDirectField)
			|| (outputRequested || releaseOutput) && DOCUMENT_OUTPUT_FIELDS.has(field as ControlDirectField);
		const requestedRuntimeFields = Object.keys(patch)
			.filter(isRuntimeField);
		const targetOnly = intent.requestedCoverage !== 'full';
		const directConflict = outputRequested && state.mediaRoute === 'direct' && patch.audioEnabled !== false;
		if ((targetOnly || directConflict) && requestedRuntimeFields.length > 0) {
			return Object.fromEntries(requestedRuntimeFields.map((field) => [field, {
				desired: patch[field] as ControlValues[ControlField],
				actual: null,
				revision: intent.baseRevision + 1,
				phase: 'error',
				strategy: 'unsupported',
				coverage: 'partial',
				controlled: false,
				intentId: intent.intentId,
				lastError: {
					code: targetOnly ? 'coverage-incomplete' : 'capability-unavailable',
					message: targetOnly ? 'The shared audio processor requires explicit full-output coverage'
						: 'The direct processing route cannot control document output',
					retryable: targetOnly,
				},
			}])) as ControlFieldStates;
		}
		const changes: Partial<PolicyExecutorState['config']> = {};
		if (outputRequested) changes.documentOutput = true;
		if (releaseOutput) {
			changes.documentOutput = undefined;
			changes.volumeBase = 100;
			changes.muted = false;
		}
		for (const [rawField, rawValue] of Object.entries(patch)) {
			const field = rawField as ControlDirectField;
			if (!isRuntimeField(field)) continue;
			switch (field) {
				case 'volumeBase': changes.volumeBase = rawValue as number; break;
				case 'mediaMuted': changes.muted = rawValue as boolean; break;
				case 'audioEnabled': changes.enabled = rawValue as boolean; break;
				case 'boost': changes.boost = rawValue as number; break;
				case 'eqValues': changes.eqValues = [...rawValue as number[]]; break;
				case 'bass': changes.bass = rawValue as boolean; break;
				case 'compressor': changes.compressor = rawValue as boolean; break;
				case 'mono': changes.mono = rawValue as boolean; break;
				case 'pan': changes.pan = rawValue as number; break;
				case 'delay': changes.delay = rawValue as number; break;
			}
		}
		if (changes.boost !== undefined || changes.volumeBase !== undefined) {
			const current = resolveAudioVolume(state.config);
			changes.volumeBase ??= current.volumeBase;
			changes.volume = compileEffectiveVolume(changes.volumeBase, changes.boost ?? current.boost);
		}
		// The existing OSD has exact actual-value projections only for effective volume,
		// Boost and speed. Pan/delay/mono hotkeys retain their listener-owned label
		// instead of displaying a misleading volume OSD and then a second toast.
		const persisted = await policyExecutor.updateConfig(changes, {
			...(intent.captureAdmission
				? { captureAdmission: intent.captureAdmission }
				: {}),
			// The ACK only needs the applied fields below; the snapshot durability
			// write is a redundant background copy (the SW commit persists the same
			// session projection) and must not gate or delay the crossing ACK.
			deferPersistence: true,
		});
		if (!persisted.ok) throw new Error(persisted.error.message);

		const applied = state.appliedConfig;
		const fields: ControlFieldStates = {};
		const acknowledgedFields = new Set<ControlDirectField>(
			requestedRuntimeFields,
		);
		if (releaseOutput) for (const field of DOCUMENT_OUTPUT_FIELDS) acknowledgedFields.add(field);
		// `audioEnabled` is the compound session gate. A toggle ACK includes the
		// actual state of every dependent DSP field so Popup/remote never retain a
		// stale "active" processor after disable or hide a startup failure on enable.
		if (patch.audioEnabled !== undefined) {
			for (const field of AUDIO_RUNTIME_CONTROL_FIELDS) acknowledgedFields.add(field);
			if (outputRequested) for (const field of DOCUMENT_OUTPUT_FIELDS) acknowledgedFields.add(field);
		}
		for (const field of acknowledgedFields) {
			let desired: ControlValues[ControlField];
			switch (field) {
				case 'volumeBase': desired = state.config.volumeBase; break;
				case 'mediaMuted': desired = state.config.muted; break;
				case 'audioEnabled': desired = state.config.enabled; break;
				case 'boost': desired = resolveAudioVolume(state.config).boost; break;
				case 'eqValues': desired = [...state.config.eqValues]; break;
				case 'bass': desired = state.config.bass; break;
				case 'compressor': desired = state.config.compressor; break;
				case 'mono': desired = state.config.mono; break;
				case 'pan': desired = state.config.pan; break;
				case 'delay': desired = state.config.delay; break;
				default: continue;
			}
			let actual: ControlValues[ControlField];
			switch (field) {
				case 'volumeBase': actual = applied.volumeBase; break;
				case 'mediaMuted': actual = applied.muted; break;
				case 'audioEnabled': actual = actualAudioEnabled(state); break;
				case 'boost': actual = resolveAudioVolume(applied).boost; break;
				case 'eqValues': actual = [...applied.eqValues]; break;
				case 'bass': actual = applied.bass; break;
				case 'compressor': actual = applied.compressor; break;
				case 'mono': actual = applied.mono; break;
				case 'pan': actual = applied.pan; break;
				case 'delay': actual = applied.delay; break;
				default: continue;
			}
			const matches = JSON.stringify(desired) === JSON.stringify(actual)
				&& (!outputRequested || patch.audioEnabled === false || documentOutputAcknowledged(state));
			const isDisabledRelease = patch.audioEnabled === false && field !== 'audioEnabled';
			const isNeutralRelease = field !== 'audioEnabled'
				&& !outputRequested
				&& state.actualMode === 'bypass'
				&& matches;
			const strategy: ControlStrategy = field === 'audioEnabled'
				? 'extension-state'
				: isDisabledRelease || isNeutralRelease
					? 'observe'
					: state.actualMode === 'capture'
						? 'capture'
						: state.actualMode === 'webaudio'
							? 'media-webaudio'
							: 'unsupported';
			// A route this document can never obtain is not a readback disagreement.
			// Flattening both into `readback-mismatch` made a background tab's boost
			// look like a broken write with an internal sentence attached.
			const admissionGap = state.lastError === CAPTURE_ADMISSION_REQUIRED;
			// The acknowledged Boost is the document's own answer to "who owns the
			// scale above 100", and it outranks any page-level guess. Publishing it
			// here is what lets every palette surface predict the next crossing
			// instead of waiting for the acknowledgement that settles it.
			if (field === 'boost') state.boostRoute = resolveBoostRoute(strategy);
			(fields as Record<string, unknown>)[field] = {
				desired,
				actual,
				revision: intent.baseRevision + 1,
				phase: isDisabledRelease ? 'idle' : matches ? 'applied' : 'error',
				strategy,
				coverage: strategy === 'capture'
					? 'opaque'
					: intent.requestedCoverage,
				controlled: matches && !isNeutralRelease && !isDisabledRelease,
				intentId: intent.intentId,
				lastError: isDisabledRelease || matches
					? null
					: {
						code: admissionGap ? 'capability-unavailable' : 'readback-mismatch',
						message: typeof state.lastError === 'string' && state.lastError.trim().length > 0 ? state.lastError.trim() : 'Audio runtime did not apply the requested value',
						retryable: !admissionGap,
					},
			};
		}
		return fields;
	};
	return {
		apply,
		read,
		readAudioVolume(volumeBase, muted) {
			const applied = state.appliedConfig;
			const volume = applied.documentOutput === true ? applied.volume
				: compileEffectiveVolume(volumeBase, resolveAudioVolume(applied).boost);
			return {
				effectiveVolume: volume,
				volumeState: resolveAudioVolumeState({ volume,
					muted: applied.documentOutput === true ? applied.muted : muted,
					actualMode: state.actualMode, phase: state.phase }),
			};
		},
		synchronizeNative,
		...(fullscreenHandoff
			? { runFullscreenTransition: fullscreenHandoff.run.bind(fullscreenHandoff) }
			: {}),
	};
}
