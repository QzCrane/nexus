// goal: event-driven media status synchronization without background polling

import { isExtensionContextValid, safeSend } from '../context-guard';
import type { PolicyExecutorState } from '../../types';
import { debounce, createCleanupManager, createEventListener } from '../../utils/timing';
import { sendSpectraRequest } from '../../../shared/spectra-client';
import { hasMediaSurface } from '../../../shared/media-presence';
import { getActiveMediaRegistry } from '../media-registry';
import { getPausedAt, updatePausedAt } from '../../utils/pause-tracker';
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

	// The registry tracks attached elements; the inventory asks a stricter
	// question - is there a source the user could control? Both producers of the
	// report answer it with the same shared predicate, so the background never
	// sees a document flip between two definitions of "has media".
	const hasMedia = hasMediaSurface(document);
	const playing = getActiveMediaRegistry()?.hasPlayingMedia() ?? false;
	updatePausedAt(playing, hasMedia);
	const interacted = state?.userHasInteracted ?? false;

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
		userInteracted: interacted,
		reportRevision: nextRevision,
		playing,
		pausedAt: getPausedAt(),
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
