// goal: orchestrates PolicyEngine decisions with AudioController and CaptureManager

import { isDefaultAudioConfig } from '@nexus/contracts';
import { AudioMode, type PolicyContext, type UrlInfo } from '@nexus/audio-engine';
import { logger } from '../../../shared/logger';
import { applyToMedia } from '../../utils/media-utils';
import type { PolicyExecutorDeps, PolicyExecutorState } from '../../types';
import { executeMode, hasUserGesture, initModeExecutorCallbacks } from '../mode-executor';
import type { PolicyExecutor, InternalState } from './types';
import { updateBadge, broadcastUI } from './badge-sync';
import { setupCorsCallback, probeCorsOnMediaDetected, initCorsStatus } from './cors-handler';
import { updateConfig } from './config-updater';

const log = logger.content;

export async function createPolicyExecutor(
	deps: PolicyExecutorDeps,
	state: PolicyExecutorState,
	isCurrent: () => boolean = () => true,
): Promise<PolicyExecutor | null> {
	const startCors = await initCorsStatus();
	// A newer content runtime may have taken ownership while storage/CORS state was
	// loading. Do not let the superseded startup overwrite module-level callbacks.
	if (!isCurrent()) return null;
	const istate: InternalState = { corsStatus: startCors, lastBadgeHash: '', lastSyncHash: '' };

	if (startCors !== 'PENDING') deps.audioController.setSkipCorsCheck(true);

	const getUrlInfo = (): UrlInfo => ({
		fullUrl: window.location.href, domain: window.location.hostname, pathname: window.location.pathname, isIframe: window.self !== window.top
	});

	const applyState = (options: { navigation?: boolean; modeIntent?: boolean } = {}) => {
		const s = deps.settingsManager.get();
		const u = getUrlInfo();
		const restrict = istate.corsStatus === 'RESTRICTED';

		const ctx: PolicyContext = {
			urlInfo: u,
			enabled: state.config.enabled && (state.userHasInteracted || !isDefaultAudioConfig(state.config)),
			volume: state.config.volume,
			visualizerEnabled: s.visualizerEnabled || (state.userHasInteracted && istate.corsStatus === 'PENDING'),
			userInteracted: state.userHasInteracted,
			forceNative: istate.captureModeOverride === 'native',
			isRestricted: restrict,
			hasMediaElement: true, hasAudioContext: deps.audioController.isReady(), config: state.config
		};

		if (!deps.policyEngine?.calculateMode) {
			const dv = state.config.muted ? 0 : Math.min(1, state.config.volume / 100);
			applyToMedia(el => { el.volume = dv; el.muted = state.config.muted; });
			return;
		}

		const policyMode = deps.policyEngine.calculateMode(ctx);
		const mode = istate.captureModeOverride === 'capture' ? AudioMode.CAPTURE : policyMode;
		state.desiredMode = mode;
		const modeChanged = mode !== state.activeMode;
		if (modeChanged) {
			log.mode(state.activeMode, mode);
			if (state.activeMode === AudioMode.NATIVE_WEBAUDIO) deps.audioController.cleanup();
			state.activeMode = mode;
		}

		executeMode(deps, state, modeChanged || options.navigation === true || options.modeIntent === true);
		updateBadge(deps, state, istate);
		broadcastUI(deps, state, istate);
	};

	setupCorsCallback(deps, istate, applyState);
	const disposeModeExecutor = initModeExecutorCallbacks(deps, state, () => updateBadge(deps, state, istate), () => broadcastUI(deps, state, istate), (ch, opt) => updateConfig(deps, state, istate, ch, opt, applyState));
	probeCorsOnMediaDetected(istate, applyState);

	return {
		dispose: disposeModeExecutor,
		applyState,
		updateBadge: () => updateBadge(deps, state, istate),
		updateConfig: (ch, opt) => updateConfig(deps, state, istate, ch, opt, applyState),
		hasUserGesture: () => hasUserGesture(state),
		markUserInteracted: () => { state.userHasInteracted = true; },
		toggleCaptureMode: () => {
			const captureIsDesired = istate.captureModeOverride === 'capture'
				|| (istate.captureModeOverride === undefined
					&& (state.desiredMode === AudioMode.CAPTURE
						|| (state.actualMode === 'capture' && state.phase !== 'stopping')));
			istate.captureModeOverride = captureIsDesired ? 'native' : 'capture';
			state.userHasInteracted = true;
			// A trusted page/global hotkey or authenticated remote command is an
			// explicit user intent and may satisfy the Capture activation boundary.
			state.hasGesture = true;
			applyState({ modeIntent: true });
		},
		getActiveMode: () => state.activeMode,
		getUrlInfo,
		probeCors: () => probeCorsOnMediaDetected(istate, applyState),
	};
}

export type { PolicyExecutor } from './types';
export type { PolicyExecutorState, PolicyExecutorDeps } from '../../types';
