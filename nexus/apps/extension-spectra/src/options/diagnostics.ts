// goal: explicit local-only SPECTRA diagnostic export from Options
// inv: Options owns only the user gesture; Background owns runtime diagnostic facts and redaction

import {
	downloadLocalDiagnosticBundle,
	requestLocalDiagnosticBundle,
} from '@nexus/kernel';
import { onLangChange, t } from './i18n';

let initialized = false;

// inv: the export control is a singleton; retry must not attach a second click listener
export function initDiagnosticsSection(): void {
	const button = document.getElementById('diagnostics-export-btn') as HTMLButtonElement | null;
	const status = document.getElementById('diagnostics-status');
	if (!button || !status) return;
	if (initialized) return;
	initialized = true;
	let retired = false;
	let statusKey: 'opt_diagnostics_collecting' | 'opt_diagnostics_exported' | 'opt_diagnostics_failed' | null = null;
	const showStatus = (key: typeof statusKey): void => {
		statusKey = key;
		status.textContent = key ? t(key) : '';
	};
	onLangChange(() => {
		if (!retired && statusKey) status.textContent = t(statusKey);
	});
	window.addEventListener('pagehide', () => { retired = true; }, { once: true });

	button.addEventListener('click', () => {
		if (retired || button.disabled) return;
		button.disabled = true;
		showStatus('opt_diagnostics_collecting');
		void requestLocalDiagnosticBundle().then((bundle) => {
			if (retired || !button.isConnected) return;
			downloadLocalDiagnosticBundle(bundle);
			showStatus('opt_diagnostics_exported');
		}).catch((error) => {
			if (retired || !button.isConnected) return;
			console.error('[SPECTRA Options] Diagnostic export failed:', error);
			showStatus('opt_diagnostics_failed');
		}).finally(() => {
			if (!retired && button.isConnected) button.disabled = false;
		});
	});
}
