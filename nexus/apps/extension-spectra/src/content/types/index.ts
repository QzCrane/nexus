// goal: centralizes core type definitions for the content script ecosystem

import type {
	AudioConfig,
	MediaProcessingRoute,
	SpectraAudioMode,
	VolumeBoostRoute,
	VolumeNativeRoute,
} from '@nexus/contracts';
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
	// Route facts published by the one writer that actually carried an
	// acknowledged write, not by the surface that paints them. The palette
	// decision (`resolveVolumeTone`) cannot predict a route change under the
	// user's finger without them, and every surface - Popup, badge, OSD - has to
	// predict from the same facts or they disagree about one document.
	//
	// Both stay undefined until a write is acknowledged: an unanswered route must
	// never be read as "this document cannot amplify natively".
	volumeRoute?: VolumeNativeRoute;
	boostRoute?: VolumeBoostRoute;
	// Whether the document's own media graph can carry every processing source.
	// This is the input the mode policy uses to choose between Media WebAudio and
	// Capture, republished here so a live gesture can predict the same choice
	// without re-deriving it: `true` means amplifying above the native ceiling
	// never hijacks the tab. Undefined until the policy has looked.
	mediaWebAudio?: boolean;
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
