// goal: event-driven media status synchronization without background polling

import { isExtensionContextValid, safeSend } from '../context-guard';
import type { PolicyExecutorState } from '../../types';
import { hasMediaElements } from '../../audio/media-detection';
import { debounce, createCleanupManager, createEventListener } from '../../utils/timing';
import { sendSpectraRequest } from '../../../shared/spectra-client';
import { getActiveMediaRegistry } from '../media-registry';
import { updatePausedAt } from '../../utils/pause-tracker';
import { logger } from '../../../shared/logger';

const log = logger.content;

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

	safeSend(() => sendSpectraRequest('spectra.tab.media.report', {
		hasMediaElement: hasMedia,
		userInteracted: interacted,
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
	cleanup.add(report.cancel);
	updatePauseState();
	reportMediaState(state);
	return cleanup.dispose;
}
