// goal: shared sparse graph plus proven-safe page Media WebAudio owner

export * from './constants.js';

export {
	AudioGraphRouter,
	AUDIO_GRAPH_CROSSFADE_MS,
	AUDIO_PARAM_RAMP_MS,
	DEFAULT_AUDIO_GRAPH_CONFIG,
	audioGraphSignature,
	normalizeAudioGraphConfig,
} from './AudioGraphRouter.js';
export type {
	AudioGraphApplyOptions,
	AudioGraphConfig,
	AudioGraphRouterOptions,
	AudioGraphSnapshot,
} from './AudioGraphRouter.js';

export {
	WebAudioController,
	assessMediaSourceCoverage,
	assessMediaSourceEligibility,
} from './WebAudioController.js';
export type {
	MediaSourceCoverageAssessment,
	MediaSourceEligibility,
	MediaSourceEligibilityEvidence,
	MediaSourceEligibilityReason,
} from './WebAudioController.js';
