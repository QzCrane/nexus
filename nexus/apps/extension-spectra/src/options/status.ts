// goal: one visible, retryable failure surface for Options reads and mutations

export function showOptionsError(error: unknown): void {
	console.error('[SPECTRA Options] Settings operation failed:', error);
	const surface = document.getElementById('options-status');
	if (!surface) return;
	surface.hidden = false;
}

export function clearOptionsError(): void {
	const surface = document.getElementById('options-status');
	if (!surface) return;
	surface.hidden = true;
}

export function bindOptionsRetry(retry: () => void = () => window.location.reload()): void {
	const button = document.getElementById('options-retry') as HTMLButtonElement | null;
	if (!button) return;
	button.onclick = retry;
}
