// goal: minimal Background projection of the canonical SPECTRA control policy
// inv: This file is not an independent policy authority. Exhaustive tests compare
// every projection below against CONTROL_ALGORITHM_POLICIES in @nexus/contracts.
// Keeping only Background-consumed facts lets the MV3 worker tree-shake the
// complete 51-capability policy table from its ordinary wake bundle.

import {
	compileEffectiveVolume,
	resolveAudioVolumeState,
	type ControlAudioVolumeProjection,
	type ControlCapability,
	type ControlFieldStates,
	type ControlSessionField,
} from '@nexus/contracts';

const BACKGROUND_MEDIA_TARGET_CAPABILITIES = new Set<ControlCapability>([
	'volumeBase',
	'boost',
	'mediaMuted',
	'speed',
	'preservePitch',
	'playing',
	'currentTime',
	'loop',
	'abLoop',
	'eqValues',
	'bass',
	'compressor',
	'mono',
	'pan',
	'delay',
	'visualizer',
	'effective-volume',
	'playback-toggle',
	'seek-relative',
	'marker-add',
	'marker-remove',
	'marker-jump',
	'marker-jump-previous',
	'marker-jump-next',
	'ab-set-a',
	'ab-set-b',
	'ab-clear',
	'ab-skip',
	'audio-reset',
]);

const BACKGROUND_VIDEO_TARGET_CAPABILITIES = new Set<ControlCapability>([
	'pip',
	'fullscreen',
	'rotation',
	'mirrored',
	'fill',
	'filterEnabled',
	'filter',
	'dimEnabled',
	'dimOpacity',
	'frame-step',
	'screenshot',
	'video-effects-toggle',
	'video-effects-reset',
]);

const BACKGROUND_FULL_RESTORE_FIELDS = new Set<ControlSessionField>([
	'audioEnabled',
	'boost',
	'eqValues',
	'bass',
	'compressor',
	'mono',
	'pan',
	'delay',
]);

const BACKGROUND_VIDEO_RESTORE_FIELDS = new Set<ControlSessionField>([
	'rotation',
	'mirrored',
	'fill',
	'filterEnabled',
	'filter',
	'dimEnabled',
	'dimOpacity',
]);

export const BACKGROUND_PROCESSOR_FIELDS = Object.freeze([
	'boost',
	'eqValues',
	'bass',
	'compressor',
	'mono',
	'pan',
	'delay',
] as const);

export function backgroundControlTargetScopeFlags(
	capabilities: readonly ControlCapability[],
): { updatesMedia: boolean; updatesVideo: boolean } {
	return {
		updatesMedia: capabilities.some((capability) => BACKGROUND_MEDIA_TARGET_CAPABILITIES.has(capability)),
		updatesVideo: capabilities.some((capability) => BACKGROUND_VIDEO_TARGET_CAPABILITIES.has(capability)),
	};
}

export function backgroundRestoreBucket(field: ControlSessionField): 'media' | 'video' | 'full' {
	if (BACKGROUND_FULL_RESTORE_FIELDS.has(field)) return 'full';
	if (BACKGROUND_VIDEO_RESTORE_FIELDS.has(field)) return 'video';
	return 'media';
}

export function backgroundResolveAcknowledgedProcessorLifecycle(
	fields: ControlFieldStates,
): { actualMode: 'bypass' | 'webaudio' | 'capture'; phase: 'idle' | 'active' } | null {
	const processorStates = BACKGROUND_PROCESSOR_FIELDS.flatMap((field) => {
		const state = fields[field];
		return state === undefined ? [] : [state];
	});
	const revision = processorStates.reduce(
		(latest, field) => Math.max(latest, field.revision),
		-1,
	);
	const latest = processorStates.filter((field) => field.revision === revision);
	if (latest.some((field) => field.phase === 'applied' && field.strategy === 'capture')) {
		return { actualMode: 'capture', phase: 'active' };
	}
	if (latest.some((field) => field.phase === 'applied' && field.strategy === 'media-webaudio')) {
		return { actualMode: 'webaudio', phase: 'active' };
	}
	if (latest.some((field) => (
		(field.phase === 'applied' || field.phase === 'idle')
		&& field.strategy === 'observe'
		&& !field.controlled
	))) {
		return { actualMode: 'bypass', phase: 'idle' };
	}
	return null;
}

export function backgroundResolveAcknowledgedAudioVolumeState(
	fields: ControlFieldStates,
	effectiveVolume: number,
	muted: boolean,
) {
	const lifecycle = backgroundResolveAcknowledgedProcessorLifecycle(fields);
	return resolveAudioVolumeState({
		volume: effectiveVolume,
		muted,
		actualMode: lifecycle?.actualMode ?? 'bypass',
		phase: lifecycle?.phase ?? 'idle',
	});
}

export function backgroundResolveControlAudioVolume(
	fields: ControlFieldStates,
): ControlAudioVolumeProjection | null {
	const volumeBase = fields.volumeBase?.actual;
	const boost = fields.boost?.actual;
	const mediaMuted = fields.mediaMuted?.actual;
	if (typeof volumeBase !== 'number'
		|| typeof boost !== 'number'
		|| typeof mediaMuted !== 'boolean') return null;
	const effectiveVolume = compileEffectiveVolume(volumeBase, boost);
	return {
		effectiveVolume,
		volumeState: backgroundResolveAcknowledgedAudioVolumeState(
			fields,
			effectiveVolume,
			mediaMuted,
		),
	};
}
