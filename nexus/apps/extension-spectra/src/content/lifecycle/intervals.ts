/**
 * // goal: Maintain periodic check tasks
 * // eff: Handles state reapplication and media reporting
 */

import { AudioMode } from '@nexus/audio-engine';
import { isExtensionContextValid, safeSend } from '../context-guard';
import { logger } from '../../shared/logger';
import type { PolicyExecutorState } from '../types';
import type { PolicyExecutor } from '../policy-executor';
import type { NexusMessenger } from '@nexus/kernel';
import { hasMediaElements } from './media-observer';

const log = logger.content;

/**
 * Cleanup functions for intervals
 */
interface IntervalCleanup {
	stateReapply: ReturnType<typeof setInterval>;
	mediaReport: ReturnType<typeof setInterval>;
}

/**
 * // rule: Interval 3s, skip if hidden or context invalid
 * // eff: Re-applies state for NATIVE modes
 */
export function createStateReapplyInterval(
	state: PolicyExecutorState,
	policyExecutor: PolicyExecutor,
	onContextInvalid?: () => void
): ReturnType<typeof setInterval> {
	return setInterval(() => {
		// Skip when page hidden to save CPU
		if (document.hidden) return;

		if (!isExtensionContextValid()) {
			onContextInvalid?.();
			return;
		}

		if (state.activeMode === AudioMode.NATIVE_LITE || state.activeMode === AudioMode.NATIVE_WEBAUDIO) {
			policyExecutor.applyState();
		}
	}, 3000); // 3 seconds interval
}

/**
 * // rule: Interval 5s
 * // eff: Sends TAB_REPORT_MEDIA
 */
export function createMediaReportInterval(
	messenger: NexusMessenger,
	onContextInvalid?: () => void
): ReturnType<typeof setInterval> {
	return setInterval(() => {
		if (!isExtensionContextValid()) {
			onContextInvalid?.();
			return;
		}
		reportMediaState(messenger);
	}, 5000);
}

/**
 * // eff: Checks DOM and updates background state
 */
export function reportMediaState(messenger: NexusMessenger): void {
	if (!isExtensionContextValid()) return;

	const hasMedia = hasMediaElements();
	safeSend(() => messenger.send('TAB_REPORT_MEDIA', { hasMediaElement: hasMedia })).catch(() => {
		// Silent error
	});
}

/**
 * // eff: Clears all active intervals
 */
export function cleanupIntervals(intervals: Partial<IntervalCleanup>): void {
	if (intervals.stateReapply) clearInterval(intervals.stateReapply);
	if (intervals.mediaReport) clearInterval(intervals.mediaReport);
}
