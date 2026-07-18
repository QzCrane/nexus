// goal: assemble content runtime state from authenticated handoff and sender-bound background state

import {
	DEFAULT_AUDIO_CONFIG,
	isDefaultAudioConfig,
	type AudioConfig,
	type AudioSessionSnapshot,
} from '@nexus/contracts';
import { AudioMode, type AudioModeType } from '@nexus/audio-engine';
import type { PolicyExecutorState } from '../types';

export interface InitialStateSources {
	handoff: Partial<PolicyExecutorState> | null;
	session: AudioSessionSnapshot | null;
	config: AudioConfig | null;
}

function cloneConfig(config: AudioConfig): AudioConfig {
	return { ...config, eqValues: [...config.eqValues] };
}

function restorePolicyMode(
	session: AudioSessionSnapshot,
	config: AudioConfig,
): AudioModeType {
	if (session.desiredMode === 'capture') return AudioMode.CAPTURE;
	if (session.desiredMode === 'webaudio') return AudioMode.NATIVE_WEBAUDIO;
	return !config.enabled || isDefaultAudioConfig(config)
		? AudioMode.DISABLED
		: AudioMode.NATIVE_LITE;
}

// Background metadata wins because it represents the last acknowledged owner
// state. The isolated-world handoff remains useful for page-local gesture and
// interaction flags, while a rejected/legacy DOM-only sentinel contributes no data.
export function assembleInitialState(
	sources: InitialStateSources,
): { state: PolicyExecutorState; recovered: boolean } {
	const { handoff, session } = sources;
	const config = cloneConfig(
		handoff?.config
			?? sources.config
			?? session?.actualConfig
			?? DEFAULT_AUDIO_CONFIG,
	);
	const sessionMode = session ? restorePolicyMode(session, config) : null;
	const desiredMode = sessionMode ?? handoff?.desiredMode ?? null;
	const appliedConfig = cloneConfig(
		session?.actualConfig
			?? handoff?.appliedConfig
			?? DEFAULT_AUDIO_CONFIG,
	);

	return {
		recovered: handoff !== null || session !== null,
		state: {
			config,
			appliedConfig,
			activeMode: desiredMode,
			desiredMode,
			actualMode: session?.actualMode ?? handoff?.actualMode ?? 'bypass',
			phase: session?.phase ?? handoff?.phase ?? 'idle',
			generation: session?.generation ?? handoff?.generation ?? 0,
			lastError: session?.lastError?.message ?? handoff?.lastError,
			hasGesture: handoff?.hasGesture ?? false,
			userHasInteracted: handoff?.userHasInteracted ?? false,
			isPopupOpen: false,
			visualizerSubscribed: false,
		},
	};
}
