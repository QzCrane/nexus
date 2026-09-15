// goal: choose the lowest-cost complete audio owner from native, Media WebAudio, and Capture

import { resolveDesiredAudioMode } from '@nexus/contracts';
import { assessMediaSourceCoverage } from '@nexus/audio-engine';
import { logger } from '../../../shared/logger';
import type { PolicyExecutorDeps, PolicyExecutorState } from '../../types';
import { createModeExecutor } from '../mode-executor';
import type { PolicyApplicationOptions, PolicyExecutor, InternalState } from './types';
import { updateBadge, broadcastUI } from './badge-sync';
import { updateConfig } from './config-updater';
import {
	createSiteEligibilityCache,
	type SiteEligibility,
} from './eligibility-cache';

const log = logger.content;

export async function createPolicyExecutor(
	deps: PolicyExecutorDeps,
	state: PolicyExecutorState,
	isCurrent: () => boolean = () => true,
): Promise<PolicyExecutor | null> {
	if (!isCurrent()) return null;
	const internalState: InternalState = { lastBadgeHash: '', lastSyncHash: '' };
	const eligibilityCache = createSiteEligibilityCache(state.mediaRoute);
	let applyTail: Promise<void> = Promise.resolve();
	let disposed = false;

	const liveEligibility = (): SiteEligibility => {
		const media = deps.mediaRegistry.list().map(({ element }) => element);
		const coverage = assessMediaSourceCoverage(
			media,
			(element) => deps.mediaRegistry.getEligibilityEvidence(element),
		);
		if (coverage.eligibility === 'unsafe'
			|| media.some((element) => deps.audioController.hasKnownBindingFailure(element))) return 'RESTRICTED';
		return coverage.fullCoverage ? 'SAFE' : 'PENDING';
	};

	const applyCurrentState = async (options: PolicyApplicationOptions = {}): Promise<void> => {
		if (!isCurrent()) return;
		const eligibility = await eligibilityCache.resolve(liveEligibility());
		if (!isCurrent()) return;
		state.mediaRoute = eligibility === 'SAFE'
			? 'direct'
			: eligibility === 'RESTRICTED' ? 'capture' : 'auto';
		const media = deps.mediaRegistry.list().map(({ element }) => element);
		const mode = resolveDesiredAudioMode(state.config, {
			visualizer: state.visualizerSubscribers.size > 0,
			mediaRoute: state.mediaRoute,
			mediaWebAudio: deps.audioController.canAttachAll(
				media,
				(element) => deps.mediaRegistry.getEligibilityEvidence(element),
			),
			hold: state.processorHold,
		});
		state.desiredMode = mode;
		const modeChanged = mode !== state.activeMode;
		if (modeChanged) {
			log.mode(state.activeMode, mode);
			state.activeMode = mode;
		}

		await modeExecutor.execute(
			modeChanged || options.navigation === true || options.modeIntent === true,
			options.captureAdmission,
		);
		if (!isCurrent()) return;
		await eligibilityCache.recordActual(state.actualMode, state.phase);
		if (!isCurrent()) return;
		updateBadge(deps, state, internalState);
		broadcastUI(deps, state, internalState);
	};

	// A single document owns one physical audio graph. Serialize every policy
	// application so 100↔110 and visualizer changes cannot concurrently bypass
	// and re-apply the same graph. Because config is read when the queued task
	// starts, superseded slider values naturally coalesce to the latest intent.
	const applyState = (options: PolicyApplicationOptions = {}): Promise<void> => {
		const operation = applyTail.then(() => {
			if (disposed || !isCurrent()) return;
			return applyCurrentState(options);
		});
		applyTail = operation.catch(() => undefined);
		return operation;
	};

	const modeExecutor = createModeExecutor(
		deps,
		state,
		() => updateBadge(deps, state, internalState),
		() => broadcastUI(deps, state, internalState),
	);

	return {
		dispose() {
			disposed = true;
			modeExecutor.dispose();
		},
		applyState,
		updateBadge: () => updateBadge(deps, state, internalState),
		updateConfig: (changes, options) => updateConfig(
			deps,
			state,
			internalState,
			changes,
			options,
			applyState,
		),
		markUserInteracted: () => { state.userHasInteracted = true; },
		async refreshMediaRoute() {
			const route = await eligibilityCache.refresh();
			state.mediaRoute = route;
			return route;
		},
		getActiveMode: () => state.activeMode,
	};
}

export type { PolicyExecutor } from './types';
export type { PolicyExecutorState, PolicyExecutorDeps } from '../../types';
