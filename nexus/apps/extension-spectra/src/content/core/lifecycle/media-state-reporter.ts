// goal: event-driven media status synchronization without background polling

import { isExtensionContextValid, safeSend } from '../context-guard';
import type { PolicyExecutorState } from '../../types';
import { hasMediaElements, MEDIA_REGISTRY_CHANGED_EVENT } from './media-observer';
import { debounce, createCleanupManager, createEventListener } from '../../utils/timing';
import { sendSpectraRequest } from '../../../shared/spectra-client';

// eff: transmits the event-maintained registry state to the kernel
export function reportMediaState(state?: PolicyExecutorState): void {
	if (!isExtensionContextValid()) return;

	const hasMedia = hasMediaElements();
	const interacted = state ? (state.userHasInteracted || state.hasGesture) : false;

	safeSend(() => sendSpectraRequest('spectra.tab.media.report', {
		hasMediaElement: hasMedia,
		userInteracted: interacted,
	})).catch(() => {
		// note: failures usually indicate a closing tab session
	});
}

// eff: coalesces lifecycle events without a recurring heartbeat
export function createMediaStateReporter(
	state: PolicyExecutorState,
): () => void {
	const cleanup = createCleanupManager();
	const report = debounce(() => reportMediaState(state), 100);
	cleanup.add(createEventListener(document, MEDIA_REGISTRY_CHANGED_EVENT, report));
	cleanup.add(createEventListener(document, 'visibilitychange', report));
	cleanup.add(report.cancel);
	reportMediaState(state);
	return cleanup.dispose;
}
