// goal: centralizes core type definitions for the content script ecosystem

import type { AudioConfig, MediaProcessingRoute, SpectraAudioMode } from '@nexus/contracts';
import type { WebAudioController } from '@nexus/audio-engine';
import type { CaptureManager } from '../audio/capture-manager';
import type { MediaRegistry } from '../core/media-registry';
import type { SettingsManager } from '../core/settings-manager';
import type { DocumentRuntimeContext } from '../core/content-runtime-context';

// PolicyExecutorState: shared mutable state tracked during the tab session
export interface PolicyExecutorState {
	config: AudioConfig;
	mediaRoute: MediaProcessingRoute | 'auto';
	// Last configuration confirmed on the actual processing path. Desired config
	// may move ahead while a mode transition is still pending.
	appliedConfig: AudioConfig;
	activeMode: SpectraAudioMode | null;
	desiredMode: SpectraAudioMode | null;
	actualMode: SpectraAudioMode;
	phase: 'idle' | 'starting' | 'active' | 'stopping' | 'error';
	generation: number;
	lastError?: string;
	// userHasInteracted: sticky marker; True if user has explicitly tweaked audio via Spectra's UI or hotkeys
	userHasInteracted: boolean;
	isPopupOpen: boolean;
	// Transient, document-scoped consumers. This set is never persisted or handed
	// across runtimes; Background re-admits every live Popup subscriber.
	visualizerSubscribers: Set<string>;
}

// PolicyExecutorDeps: dependency injection container for the executor lifecycle
export interface PolicyExecutorDeps {
	captureManager: CaptureManager;
	audioController: WebAudioController;
	mediaRegistry: MediaRegistry;
	settingsManager: SettingsManager;
	/** Aborts every Content policy continuation when its DocumentRuntimeContext ends. */
	lifecycleSignal: AbortSignal;
}

// ContentDeps: full dependency container for content script initialization
export interface ContentDeps extends PolicyExecutorDeps {
	state: PolicyExecutorState;
	runtimeContext: DocumentRuntimeContext;
	policyExecutor?: import('../logic/policy-executor').PolicyExecutor;
}
