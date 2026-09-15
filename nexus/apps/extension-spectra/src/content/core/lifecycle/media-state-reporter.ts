// goal: event-driven media status synchronization without background polling

import { isExtensionContextValid, safeSend } from '../context-guard';
import type { PolicyExecutorState } from '../../types';
import { hasMediaElements } from '../../audio/media-detection';
import { debounce, createCleanupManager, createEventListener } from '../../utils/timing';
import { sendSpectraRequest } from '../../../shared/spectra-client';
import { getActiveMediaRegistry } from '../media-registry';
import { updatePausedAt } from '../../utils/pause-tracker';
import { logger } from '../../../shared/logger';
import { getContentBootstrapState } from '../../../shared/content-runtime';

const log = logger.content;
let reportRevision = 0;

function updatePauseState(): void {
	const registry = getActiveMediaRegistry();
	updatePausedAt(
		registry?.hasPlayingMedia() ?? false,
		(registry?.size ?? 0) > 0,
	);
}

// eff: transmits the event-maintained registry state to the kernel
export function reportMediaState(state?: PolicyExecutorState): void {
	if (!isExtensionContextValid()) return;

	const hasMedia = hasMediaElements();
	const interacted = state?.userHasInteracted ?? false;
	// Same inconclusiveness rule as the bootstrap reporter: when this top-level
	// document has no media but hosts subframes, the media may live in a frame
	// this world cannot read, so the background must not solidify a no-media fact.
	const hasSubframes = document.querySelector('iframe,frame') !== null;

	// The bootstrap and the runtime share one isolated-world revision counter, so
	// the background's per-document monotonic gate accepts both producers across
	// runtime handoffs. The module counter is only a fallback for documents where
	// the bootstrap state is absent (disposed or pre-bootstrap runtime boot).
	const bootstrapState = getContentBootstrapState();
	const nextRevision = bootstrapState?.mediaReportRevision === undefined
		? ++reportRevision
		: bootstrapState.mediaReportRevision + 1;
	if (bootstrapState) bootstrapState.mediaReportRevision = nextRevision;

	safeSend(() => sendSpectraRequest('spectra.tab.media.report', {
		hasMediaElement: hasMedia,
		hasSubframes,
		userInteracted: interacted,
		reportRevision: nextRevision,
	})).catch((error: unknown) => {
		log.warn('Media-state report failed outside the known context-invalidation boundary', error);
	});
}

// eff: coalesces lifecycle events without a recurring heartbeat
export function createMediaStateReporter(
	state: PolicyExecutorState,
): () => void {
	const cleanup = createCleanupManager();
	const registry = getActiveMediaRegistry();
	if (!registry) throw new Error('The document media registry is unavailable');
	const report = debounce(() => reportMediaState(state), 100);
	cleanup.add(registry.subscribe(() => {
		updatePauseState();
		report();
	}));
	cleanup.add(createEventListener(document, 'visibilitychange', report));
	// bfcache restore re-runs pageshow without re-injecting the content script:
	// re-report the live media state so a restored document cannot keep a stale
	// durable fact in the background inventory.
	cleanup.add(createEventListener(window, 'pageshow', report));
	cleanup.add(report.cancel);
	updatePauseState();
	reportMediaState(state);
	return cleanup.dispose;
}
