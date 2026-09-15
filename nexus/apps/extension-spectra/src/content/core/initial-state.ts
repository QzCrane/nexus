// goal: assemble content runtime state from authenticated handoff and sender-bound background state

import {
	DEFAULT_AUDIO_CONFIG,
	requiresAudioProcessor,
	resolveDesiredAudioMode,
	type AudioConfig,
	type MediaProcessingRoute,
	type AudioSessionSnapshot,
} from '@nexus/contracts';
import type { PolicyExecutorState } from '../types';

export interface InitialStateSources {
	handoff: Partial<PolicyExecutorState> | null;
	session: AudioSessionSnapshot | null;
	config: AudioConfig | null;
	mediaRoute?: MediaProcessingRoute | 'auto';
}

export type InitialStateSource = 'handoff' | 'session' | 'fresh';

// post: loading the document runtime to observe an acknowledged Capture never
// becomes a new mode intent. Capture is owned by Background/offscreen and must
// be hydrated first; a later explicit control, configuration or navigation
// event may ask PolicyExecutor to transition it.
export function shouldApplyInitialPolicy(
	state: Pick<PolicyExecutorState, 'actualMode' | 'desiredMode'>,
	source: InitialStateSource,
): boolean {
	// Same-document handoff preserves the native DOM and Background/offscreen
	// Capture owner. Re-running policy before
	// READY would turn hydration into a new control intent. A sender-bound session
	// still needs policy reconstruction unless Capture already owns the processor.
	return source === 'fresh'
		|| source === 'session'
			&& (state.actualMode !== 'capture' || state.desiredMode !== 'capture');
}

function cloneConfig(config: AudioConfig): AudioConfig {
	return { ...config, eqValues: [...config.eqValues] };
}

function restorePolicyMode(
	session: AudioSessionSnapshot,
	config: AudioConfig,
	mediaRoute: MediaProcessingRoute | 'auto',
): PolicyExecutorState['desiredMode'] {
	if (requiresAudioProcessor(config) && mediaRoute === 'direct') return 'webaudio';
	if (requiresAudioProcessor(config) && mediaRoute === 'capture') return 'capture';
	if (session.desiredMode === 'webaudio' && requiresAudioProcessor(config)) return 'webaudio';
	return session.desiredMode === 'capture' && requiresAudioProcessor(config)
		? 'capture'
		: resolveDesiredAudioMode(config);
}

// Background metadata wins because it represents the last acknowledged owner
// state. The isolated-world handoff remains useful for page-local gesture and
// interaction flags, while a rejected/legacy DOM-only sentinel contributes no data.
export function assembleInitialState(
	sources: InitialStateSources,
): { state: PolicyExecutorState; source: InitialStateSource } {
	const { handoff, session } = sources;
	const source: InitialStateSource = handoff !== null
		? 'handoff'
		: session !== null
			? 'session'
			: 'fresh';
	const config = cloneConfig(
		handoff?.config
			?? sources.config
			?? session?.actualConfig
			?? DEFAULT_AUDIO_CONFIG,
	);
	const mediaRoute = handoff?.mediaRoute ?? sources.mediaRoute ?? 'auto';
	const sessionMode = session ? restorePolicyMode(session, config, mediaRoute) : null;
	const desiredMode = sessionMode ?? handoff?.desiredMode ?? null;
	const appliedConfig = cloneConfig(
		session?.actualConfig
			?? handoff?.appliedConfig
			?? DEFAULT_AUDIO_CONFIG,
	);

	return {
		source,
		state: {
			config,
			mediaRoute,
			appliedConfig,
			activeMode: desiredMode,
			desiredMode,
			actualMode: session?.actualMode ?? handoff?.actualMode ?? 'bypass',
			phase: session?.phase ?? handoff?.phase ?? 'idle',
			generation: session?.generation ?? handoff?.generation ?? 0,
			lastError: session?.lastError?.message ?? handoff?.lastError,
				userHasInteracted: handoff?.userHasInteracted ?? false,
				isPopupOpen: false,
				visualizerSubscribers: new Set<string>(),
				processorHold: false,
			},
	};
}
