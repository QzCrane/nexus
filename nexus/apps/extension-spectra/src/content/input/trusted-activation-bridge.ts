// goal: expose one lifecycle-bound PiP trigger inside the extension isolated world

import {
	SPECTRA_TRUSTED_PIP_EVENT,
} from '../../shared/trusted-activation';
import { submitTrustedActivationControl } from './hotkey-helpers';

export function registerTrustedActivationBridge(): () => void {
	let inFlight = false;
	const onToggle = () => {
		if (inFlight || !navigator.userActivation.isActive) return;
		inFlight = true;
		void submitTrustedActivationControl('pip')
			.catch(() => undefined)
			.finally(() => {
				inFlight = false;
			});
	};
	document.addEventListener(SPECTRA_TRUSTED_PIP_EVENT, onToggle);
	return () => {
		document.removeEventListener(SPECTRA_TRUSTED_PIP_EVENT, onToggle);
	};
}
