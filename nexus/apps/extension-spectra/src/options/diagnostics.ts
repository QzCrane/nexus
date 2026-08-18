// goal: explicit local-only SPECTRA diagnostic export from Options
// inv: Options owns only the user gesture; Background owns runtime diagnostic facts and redaction

import {
	downloadLocalDiagnosticBundle,
	requestLocalDiagnosticBundle,
} from '@nexus/kernel';

export function initDiagnosticsSection(): void {
	const button = document.getElementById('diagnostics-export-btn') as HTMLButtonElement | null;
	const status = document.getElementById('diagnostics-status');
	if (!button || !status) return;

	button.addEventListener('click', () => {
		button.disabled = true;
		status.textContent = 'Collecting local diagnostic facts…';
		void requestLocalDiagnosticBundle().then((bundle) => {
			downloadLocalDiagnosticBundle(bundle);
			status.textContent = 'Diagnostic JSON exported locally. No data was sent.';
		}).catch(() => {
			status.textContent = 'Diagnostic export failed.';
		}).finally(() => {
			button.disabled = false;
		});
	});
}
