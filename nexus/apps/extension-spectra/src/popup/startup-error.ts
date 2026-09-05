// goal: owns the accessible, retryable failure state when Popup bootstrap cannot reach settings

const SURFACE_ID = 'popup-startup-status';

function localizedMessage(key: string, fallback: string): string {
	try {
		return chrome.i18n.getMessage(key) || fallback;
	} catch {
		return fallback;
	}
}

export function clearPopupStartupError(): void {
	document.getElementById(SURFACE_ID)?.remove();
}

export function showPopupStartupError(
	error: unknown,
	retry: () => Promise<void>,
): void {
	clearPopupStartupError();
	const surface = document.createElement('section');
	surface.id = SURFACE_ID;
	surface.className = 'popup-startup-status';
	surface.setAttribute('role', 'alert');
	surface.setAttribute('aria-live', 'assertive');
	surface.setAttribute('aria-atomic', 'true');

	const message = document.createElement('p');
	const detail = error instanceof Error ? error.message : String(error);
	message.textContent = `${localizedMessage(
		'popupStartupFailed',
		'SPECTRA is temporarily unavailable.',
	)} ${detail}`;

	const button = document.createElement('button');
	button.type = 'button';
	button.textContent = localizedMessage('popupRetry', 'Retry');
	button.onclick = () => {
		button.disabled = true;
		button.setAttribute('aria-busy', 'true');
		clearPopupStartupError();
		void retry().catch((retryError: unknown) => {
			showPopupStartupError(retryError, retry);
		});
	};
	surface.append(message, button);
	document.body.appendChild(surface);
}
