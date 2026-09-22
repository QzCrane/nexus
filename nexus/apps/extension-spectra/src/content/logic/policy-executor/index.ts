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
	let routeRevision = 0;

	const liveEligibility = (): SiteEligibility => {
		const media = deps.mediaRegistry.listProcessingSources().map(({ element }) => element);
		const coverage = assessMediaSourceCoverage(
			media,
			(element) => deps.mediaRegistry.getEligibilityEvidence(element),
		);
		if (coverage.eligibility === 'unsafe'
			|| media.some((element) => deps.audioController.hasKnownBindingFailure(element))) return 'RESTRICTED';
		return coverage.fullCoverage ? 'SAFE' : 'PENDING';
	};

	const applyCurrentState = async (
		options: PolicyApplicationOptions = {},
		expectedRouteRevision = routeRevision,
	): Promise<void> => {
		const routeIsCurrent = () => expectedRouteRevision === routeRevision;
		if (!isCurrent() || !routeIsCurrent()) return;
		await eligibilityCache.resolve(liveEligibility());
		if (!isCurrent() || !routeIsCurrent()) return;
		// Source eligibility is evidence, not a user-imposed route. A proven
		// candidate can still fail its first binding and require admitted Capture.
		state.mediaRoute = eligibilityCache.getUserRoute();
		const media = deps.mediaRegistry.listProcessingSources().map(({ element }) => element);
		const mode = resolveDesiredAudioMode(state.config, {
			visualizer: state.visualizerSubscribers.size > 0,
			mediaRoute: state.mediaRoute,
			mediaWebAudio: deps.audioController.canAttachAll(
				media,
				(element) => deps.mediaRegistry.getEligibilityEvidence(element),
			),
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
		if (!isCurrent() || !routeIsCurrent()) return;
		await eligibilityCache.recordActual(state.actualMode, state.phase);
		if (!isCurrent() || !routeIsCurrent()) return;
		updateBadge(deps, state, internalState);
		broadcastUI(deps, state, internalState);
	};

	// A single document owns one physical audio graph. Serialize every policy
	// application so 100↔110 and visualizer changes cannot concurrently bypass
	// and re-apply the same graph. Because config is read when the queued task
	// starts, superseded slider values naturally coalesce to the latest intent.
	const enqueueApplication = (task: () => Promise<void> | void): Promise<void> => {
		const operation = applyTail.then(() => {
			if (disposed || !isCurrent()) return;
			return task();
		});
		applyTail = operation.catch(() => undefined);
		return operation;
	};
	const applyState = (options: PolicyApplicationOptions = {}): Promise<void> => {
		const expectedRouteRevision = routeRevision;
		return enqueueApplication(() => applyCurrentState(options, expectedRouteRevision));
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
		applyNavigation(isCurrentRoute) {
			const expectedRouteRevision = ++routeRevision;
			// Invalidate the physical mode transaction synchronously. A later route
			// cannot wait behind an older Capture stop and then accept its stale ACK.
			modeExecutor.invalidate();
			return enqueueApplication(async () => {
				if (!isCurrentRoute() || expectedRouteRevision !== routeRevision) return;
				await eligibilityCache.refresh();
				if (!isCurrentRoute() || !isCurrent() || expectedRouteRevision !== routeRevision) return;
				state.mediaRoute = eligibilityCache.getUserRoute();
				await applyCurrentState({ navigation: true }, expectedRouteRevision);
			});
		},
		applyMediaRouteChange() {
			const expectedRouteRevision = routeRevision;
			return enqueueApplication(async () => {
				await eligibilityCache.refresh();
				if (!isCurrent() || expectedRouteRevision !== routeRevision) return;
				const route = eligibilityCache.getUserRoute();
				state.mediaRoute = route;
				if (route !== 'direct') return;
				modeExecutor.invalidate();
				await applyCurrentState({ modeIntent: true }, expectedRouteRevision);
			});
		},
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
		refreshMediaRoute() {
			let route: PolicyExecutorState['mediaRoute'] = state.mediaRoute;
			return enqueueApplication(async () => {
				await eligibilityCache.refresh();
				route = eligibilityCache.getUserRoute();
				state.mediaRoute = route;
			}).then(() => route);
		},
		getActiveMode: () => state.activeMode,
	};
}

export type { PolicyExecutor } from './types';
export type { PolicyExecutorState, PolicyExecutorDeps } from '../../types';
