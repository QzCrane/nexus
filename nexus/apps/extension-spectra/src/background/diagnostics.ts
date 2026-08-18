// goal: Background-owned, privacy-bounded SPECTRA diagnostic facts
// inv: owner summaries contain only booleans, finite numbers or null; no tab/session/page identity

import {
	createDiagnosticEventBuffer,
	installLocalDiagnosticPort,
	installUnhandledDiagnosticEvents,
	type DiagnosticOwnerSummary,
} from '@nexus/kernel';
import { badgeState, captureStates, tabAudioStates } from './state';
import {
	getOffscreenLeaseCount,
	isOffscreenHostStateUnknown,
	reconcileOffscreenHost,
} from './offscreen-coordinator';

const events = createDiagnosticEventBuffer();
let initialized = false;

export async function collectSpectraDiagnosticOwners(): Promise<DiagnosticOwnerSummary> {
	const [audibleTabs, userScriptsPermissionGranted, hostSnapshot] = await Promise.all([
		chrome.tabs.query({ audible: true }).catch(() => [] as chrome.tabs.Tab[]),
		chrome.permissions.contains({ permissions: ['userScripts'] }).catch(() => false),
		reconcileOffscreenHost().catch(() => null),
	]);
	const activeCaptureCount = [...captureStates.values()].filter(Boolean).length;
	return {
		backgroundSurfaceActive: true,
		audibleTabCount: audibleTabs.length,
		userScriptsPermissionGranted,
		captureStateCount: captureStates.size,
		activeCaptureCount,
		badgeStateCount: badgeState.size,
		mediaTabStateCount: tabAudioStates.size,
		offscreenLeaseCount: getOffscreenLeaseCount(),
		offscreenHostStateUnknown: isOffscreenHostStateUnknown(),
		offscreenReconcileSucceeded: hostSnapshot !== null,
		offscreenAudioProcessorCount: hostSnapshot?.audioTabs.length ?? null,
		offscreenRemoteSessionCount: hostSnapshot?.remoteTabs.length ?? null,
	};
}

export function initializeBackgroundDiagnostics(): void {
	if (initialized) return;
	initialized = true;
	installUnhandledDiagnosticEvents(events, 'background');
	installLocalDiagnosticPort({
		product: 'SPECTRA',
		owners: collectSpectraDiagnosticOwners,
		events,
	});
}
