// goal: shared sparse graph plus proven-safe page Media WebAudio owner

export * from './constants.js';

export {
	AudioGraphRouter,
	AUDIO_GRAPH_CROSSFADE_MS,
	AUDIO_PARAM_RAMP_MS,
	DEFAULT_AUDIO_GRAPH_CONFIG,
	audioGraphSignature,
	normalizeAudioGraphConfig,
} from './audio-graph-router.js';
export type {
	AudioGraphApplyOptions,
	AudioGraphConfig,
	AudioGraphRouterOptions,
	AudioGraphSnapshot,
} from './audio-graph-router.js';

export {
	WebAudioController,
	assessMediaSourceCoverage,
	assessMediaSourceEligibility,
} from './web-audio-controller.js';
export type {
	MediaSourceCoverageAssessment,
	MediaSourceEligibility,
	MediaSourceEligibilityEvidence,
	MediaSourceEligibilityReason,
} from './web-audio-controller.js';
