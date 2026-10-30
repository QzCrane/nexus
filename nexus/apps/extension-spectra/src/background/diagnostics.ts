// goal: Background-owned, privacy-bounded SPECTRA diagnostic facts
// inv: owner summaries contain only booleans, finite numbers or null; no tab/session/page identity
// inv: collection observes existing owners and never creates/reconciles offscreen authority

import {
	createDiagnosticEventBuffer,
	installLocalDiagnosticPort,
	type DiagnosticOwnerSummary,
} from '@nexus/kernel';
import { badgeState, captureStates, tabAudioStates } from './state';
import {
	getOffscreenLeaseCount,
	isOffscreenHostStateUnknown,
	sendOffscreenMessageIfPresent,
} from './offscreen-coordinator';
import { getBackgroundTabRequestDiagnostics } from './background-rpc';
import { getPopupControlDiagnostics } from './popup-control-port';
import { getRuntimeLoaderDiagnostics } from './runtime-loader';
import { mediaFacts } from './media-facts';

const events = createDiagnosticEventBuffer();
let initialized = false;

async function readOffscreenOwners(): Promise<{
	readSucceeded: boolean;
	hostPresent: boolean | null;
	audioProcessorCount: number | null;
	remoteSessionCount: number | null;
}> {
	try {
		const snapshot = await sendOffscreenMessageIfPresent({ type: 'OFFSCREEN_HOST_HELLO' });
		return {
			readSucceeded: true,
			hostPresent: snapshot !== undefined,
			audioProcessorCount: snapshot?.audioTabs.length ?? 0,
			remoteSessionCount: snapshot?.remoteTabs.length ?? 0,
		};
	} catch {
		return {
			readSucceeded: false,
			hostPresent: null,
			audioProcessorCount: null,
			remoteSessionCount: null,
		};
	}
}

export async function collectSpectraDiagnosticOwners(): Promise<DiagnosticOwnerSummary> {
	const [audibleTabs, userScriptsPermissionGranted, offscreen] = await Promise.all([
		chrome.tabs.query({ audible: true }).catch(() => null),
		chrome.permissions.contains({ permissions: ['userScripts'] }).catch(() => null),
		readOffscreenOwners(),
	]);
	const activeCaptureCount = [...captureStates.values()].filter(Boolean).length;
	return {
		backgroundSurfaceActive: true,
		...getBackgroundTabRequestDiagnostics(),
		...getPopupControlDiagnostics(),
		...getRuntimeLoaderDiagnostics(),
		audibleTabCount: audibleTabs?.length ?? null,
		userScriptsPermissionGranted,
		captureStateCount: captureStates.size,
		activeCaptureCount,
		badgeStateCount: badgeState.size,
		mediaTabStateCount: tabAudioStates.size,
		offscreenLeaseCount: getOffscreenLeaseCount(),
		offscreenHostStateUnknown: isOffscreenHostStateUnknown(),
		offscreenReadSucceeded: offscreen.readSucceeded,
		offscreenHostPresent: offscreen.hostPresent,
		offscreenAudioProcessorCount: offscreen.audioProcessorCount,
		offscreenRemoteSessionCount: offscreen.remoteSessionCount,
		mediaFactCount: mediaFacts.size(),
	};
}

export function initializeBackgroundDiagnostics(): void {
	if (initialized) return;
	initialized = true;
	// Collection is port-triggered by an extension UI. No background console
	// interception, telemetry timer, polling loop, or diagnostic storage owner exists.
	installLocalDiagnosticPort({
		product: 'SPECTRA',
		owners: collectSpectraDiagnosticOwners,
		events,
	});
}
