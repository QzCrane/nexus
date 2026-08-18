// goal: explicit local-only SPECTRA diagnostic export from Options
// inv: collection is user-triggered and the shared kernel contract excludes page identity and storage values

import {
	buildLocalDiagnosticBundle,
	createDiagnosticEventBuffer,
	downloadLocalDiagnosticBundle,
	installUnhandledDiagnosticEvents,
} from '@nexus/kernel';

const events = createDiagnosticEventBuffer();
let disposeErrorCapture: (() => void) | null = null;

async function diagnosticOwners() {
	const [audibleTabs, userScriptsGranted] = await Promise.all([
		chrome.tabs.query({ audible: true }).catch(() => [] as chrome.tabs.Tab[]),
		chrome.permissions.contains({ permissions: ['userScripts'] }).catch(() => false),
	]);
	return {
		audibleTabCount: audibleTabs.length,
		userScriptsPermissionGranted: userScriptsGranted,
		optionsSurfaceActive: true,
	};
}

export function initDiagnosticsSection(): void {
	const button = document.getElementById('diagnostics-export-btn') as HTMLButtonElement | null;
	const status = document.getElementById('diagnostics-status');
	if (!button || !status) return;
	if (!disposeErrorCapture) disposeErrorCapture = installUnhandledDiagnosticEvents(events, 'options');

	button.addEventListener('click', () => {
		button.disabled = true;
		status.textContent = 'Collecting local diagnostic facts…';
		void buildLocalDiagnosticBundle({
			product: 'SPECTRA',
			owners: diagnosticOwners,
			events,
		}).then((bundle) => {
			events.record('info', 'options', 'diagnostic-exported');
			downloadLocalDiagnosticBundle(bundle);
			status.textContent = 'Diagnostic JSON exported locally. No data was sent.';
		}).catch(() => {
			events.record('error', 'options', 'diagnostic-export-failed');
			status.textContent = 'Diagnostic export failed.';
		}).finally(() => {
			button.disabled = false;
		});
	});

	window.addEventListener('pagehide', () => {
		disposeErrorCapture?.();
		disposeErrorCapture = null;
	}, { once: true });
}
