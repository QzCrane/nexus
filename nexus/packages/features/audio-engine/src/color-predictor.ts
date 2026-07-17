// goal: unified heuristics for predicting UI color states (e.g., CAPTURE vs NATIVE) based on audit policy

import { resolveAudioVolume, type AudioConfig } from '@nexus/contracts';

export interface ColorContext {
	config: AudioConfig;
	isRestricted: boolean;
	visualizerEnabled: boolean;
}

// One canonical answer for whether output processing is required. Visualizer
// is intentionally absent: it may observe an already-owned processor, but it
// never creates Media WebAudio or Capture by itself.
export function requiresAudioProcessor(config: AudioConfig): boolean {
	return resolveAudioVolume(config).boost > 1
		|| config.eqValues.some((value) => value !== 0)
		|| config.compressor
		|| config.bass
		|| config.mono
		|| config.pan !== 0
		|| config.delay !== 0;
}

// eff: compatibility projection for UI color logic; processor admission stays
// identical to PolicyEngine and does not treat visualization as a writer.
export function needsAdvancedProcessing(ctx: ColorContext): boolean {
	return requiresAudioProcessor(ctx.config);
}

// eff: returns true if the environment warrants CAPTURE mode (Restricted + Advanced Needs)
export function predictCapture(ctx: ColorContext): boolean {
	return ctx.config.enabled && ctx.isRestricted && needsAdvancedProcessing(ctx);
}
