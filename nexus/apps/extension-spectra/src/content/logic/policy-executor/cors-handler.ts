// goal: manages CORS detection lifecycle by reconciling registry lookups with real-time WebAudio probes
// note: createMediaElementSource() silences audio on CORS failure without throwing; status is inferred via AnalyserNode data

import { safeSend } from '../../core/context-guard';
import { showToast } from '../../ui/toast';
import { logger } from '../../../shared/logger';
import type { PolicyExecutorDeps } from '../../types';
import type { InternalState, CorsStatus } from './types';
import { findProbeCandidate } from './media-probe';
import { markRegistryDomainProbed, queryRegistryDomain } from '../../../shared/registry-client';

const log = logger.content;

function formatDomainMessage(template: string, domain: string): string {
	return template.replaceAll('{domain}', domain);
}

// post: returns the persisted CORS status from the domain registry or PENDING if unknown
export async function initCorsStatus(): Promise<CorsStatus> {
	const hostname = window.location.hostname;

	try {
		const result = await safeSend(() => queryRegistryDomain(hostname));

		if (result?.entry) {
			if (result.entry.probed) {
				return result.entry.restricted ? 'RESTRICTED' : 'SAFE';
			}
			// note: unprobed entries in registry are treated as RESTRICTED to avoid audio silence during detection
			return 'RESTRICTED';
		}

		return 'PENDING';
	} catch {
		return 'PENDING';
	}
}

// eff: binds success/failure handlers to the AudioController to resolve PENDING CORS states
export function setupCorsCallback(
	deps: PolicyExecutorDeps,
	internalState: InternalState,
	onStatusChange: () => void
): void {
	const { audioController, settingsManager } = deps;

	audioController.setCallbacks(
		// failure: CORS restriction detected (no audio data passing through node)
		(hostname) => {
			if (internalState.corsStatus !== 'PENDING') return;

			log.info(`[CORS] Decision: RESTRICTED for ${hostname}`);
			internalState.corsStatus = 'RESTRICTED';

			const settings = settingsManager.get();
			safeSend(() => markRegistryDomainProbed(hostname, true))
				.then((response) => {
					if (response) {
						showToast(formatDomainMessage(settings.osdMessages.corsAutoAdded, hostname));
					}
				})
				.catch(() => { });

			onStatusChange();
		},
		// success: audio data captured (SAFE status overrides any prior conservative RESTRICTED markers)
		(hostname) => {
			if (internalState.corsStatus === 'SAFE') return;

			const wasRestricted = internalState.corsStatus === 'RESTRICTED';
			if (wasRestricted) {
				log.info(`[CORS] Correcting: ${hostname} RESTRICTED -> SAFE`);
			} else {
				log.info(`[CORS] Decision: SAFE for ${hostname}`);
			}
			internalState.corsStatus = 'SAFE';

			const settings = settingsManager.get();
			safeSend(() => markRegistryDomainProbed(hostname, false))
				.then((response) => {
					const message = wasRestricted
						? settings.osdMessages.corsCorrectedSafe
						: settings.osdMessages.corsAddedSafe;
					if (response) showToast(formatDomainMessage(message, hostname));
				})
				.catch(() => { });

			onStatusChange();
		}
	);
}

// goal: triggers an active CORS probe if suitable audible media is discovered while status is PENDING
export async function probeCorsOnMediaDetected(
	internalState?: InternalState,
	onStatusChange?: () => void
): Promise<void> {
	const hostname = window.location.hostname;

	if (internalState && internalState.corsStatus !== 'PENDING') {
		return;
	}

	try {
		const result = await safeSend(() => queryRegistryDomain(hostname));

		if (result?.entry?.probed) {
			log.debug(`[CORS Sync] ${hostname}: Already probed (${result.entry.restricted ? 'RESTRICTED' : 'SAFE'})`);
			if (internalState) {
				internalState.corsStatus = result.entry.restricted ? 'RESTRICTED' : 'SAFE';
				onStatusChange?.();
			}
			return;
		}

		// note: dataset.vmProbed prevents redundant probe attempts on the same element
		const candidateEl = findProbeCandidate();
		if (candidateEl && !candidateEl.dataset.vmProbed) {
			log.debug(`[CORS Sync] ${hostname}: Found probe candidate, triggering check`);
			candidateEl.dataset.vmProbed = 'true';
		}

		log.debug(`[CORS Sync] ${hostname}: Unknown, awaiting WebAudioController callback`);

	} catch (err) {
		log.debug(`[CORS Sync] Query failed: ${err}`);
	}
}

