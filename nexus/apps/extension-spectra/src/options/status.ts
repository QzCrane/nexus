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

// rule: recovery is an explicit caller-owned action. A document reload would
// silently discard the page's live settings projection instead of re-running it.
export function bindOptionsRetry(retry: () => void): void {
	const button = document.getElementById('options-retry') as HTMLButtonElement | null;
	if (!button) return;
	button.onclick = retry;
}
