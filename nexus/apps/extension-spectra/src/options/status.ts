// goal: one visible, retryable failure surface for Options reads and mutations

export function showOptionsError(error: unknown): void {
	const surface = document.getElementById('options-status');
	if (!surface) return;
	const detail = error instanceof Error ? error.message : String(error);
	const message = document.getElementById('options-status-message') ?? surface;
	message.textContent = `Settings are temporarily unavailable. ${detail}`;
	surface.hidden = false;
}

export function clearOptionsError(): void {
	const surface = document.getElementById('options-status');
	if (!surface) return;
	surface.hidden = true;
	const message = document.getElementById('options-status-message') ?? surface;
	message.textContent = '';
}

export function bindOptionsRetry(retry: () => void = () => window.location.reload()): void {
	const button = document.getElementById('options-retry') as HTMLButtonElement | null;
	if (!button) return;
	button.onclick = retry;
}
