// goal: centralizes type definitions for the PolicyExecutor submodule to prevent circular dependencies

import type {
	AudioConfig,
	CaptureAdmission,
	MediaProcessingRoute,
	SpectraAudioMode,
	SpectraResponse,
} from '@nexus/contracts';

export interface PolicyApplicationOptions {
	navigation?: boolean;
	modeIntent?: boolean;
	captureAdmission?: CaptureAdmission;
}

export interface PolicyUpdateOptions {
	isNativeSync?: boolean;
	captureAdmission?: CaptureAdmission;
	// Document-level processor hold intent: keep the processor session alive even
	// when the new config is neutral, so 100↔110 crossings only change gain.
	hold?: boolean;
}

// PolicyExecutor: public interface exposed to the main content script lifecycle (index.ts)
export interface PolicyExecutor {
	dispose(): void;
	// eff: re-calculates the optimal AudioMode and synchronizes the active execution layer
	applyState(options?: PolicyApplicationOptions): Promise<void>;
	updateBadge(): void;
	// note: main entry point for configuration changes originating from hotkeys or background messages
	updateConfig(
		changes: Partial<AudioConfig>,
		options?: PolicyUpdateOptions,
	): Promise<SpectraResponse<'spectra.audio.config.set'>>;
	markUserInteracted(): void;
	refreshMediaRoute(): Promise<MediaProcessingRoute | 'auto'>;
	getActiveMode(): SpectraAudioMode | null;
}

// InternalState: shared volatile state bundle for submodule coordination
export interface InternalState {
	// lastBadgeHash: deduplication key for repetitive badge update messages
	lastBadgeHash: string;
	// lastSyncHash: deduplication key for popup UI broadcasting
	lastSyncHash: string;
	// Serializes config persistence so a slower earlier message cannot overwrite
	// the newest runtime.configure value in the background session repository.
	configPersistenceTail?: Promise<void>;
}
