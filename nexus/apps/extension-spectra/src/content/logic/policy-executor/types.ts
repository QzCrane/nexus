// goal: centralizes type definitions for the PolicyExecutor submodule to prevent circular dependencies

import type { AudioConfig } from '@nexus/kernel';
import type { SpectraResponse } from '@nexus/contracts';
import type { UrlInfo } from '@nexus/audio-engine';

// PolicyExecutor: public interface exposed to the main content script lifecycle (index.ts)
export interface PolicyExecutor {
	dispose(): void;
	// eff: re-calculates the optimal AudioMode and synchronizes the active execution layer
	applyState(options?: { navigation?: boolean; modeIntent?: boolean }): void;
	updateBadge(): void;
	// note: main entry point for configuration changes originating from hotkeys or background messages
	updateConfig(
		changes: Partial<AudioConfig>,
		options?: { showOSD?: boolean; unMute?: boolean; isNativeSync?: boolean },
	): Promise<SpectraResponse<'spectra.audio.config.set'>>;
	hasUserGesture(): boolean;
	markUserInteracted(): void;
	// eff: toggles the explicit Capture override through the generation-aware mode executor
	toggleCaptureMode(): void;
	getActiveMode(): string | null;
	getUrlInfo(): UrlInfo;
	probeCors(): void;
}

// CorsStatus: transient markers used during the discovery phase of domain compatibility
export type CorsStatus = 'PENDING' | 'SAFE' | 'RESTRICTED';

// InternalState: shared volatile state bundle for submodule coordination
export interface InternalState {
	corsStatus: CorsStatus;
	// lastBadgeHash: deduplication key for repetitive badge update messages
	lastBadgeHash: string;
	// lastSyncHash: deduplication key for popup UI broadcasting
	lastSyncHash: string;
	// Serializes config persistence so a slower earlier message cannot overwrite
	// the newest runtime.configure value in the background session repository.
	configPersistenceTail?: Promise<void>;
	// A document-local user override. `native` prevents an automatic CORS policy
	// from immediately re-entering Capture after the user toggles it off.
	captureModeOverride?: 'capture' | 'native';
}
