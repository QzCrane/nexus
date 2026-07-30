// goal: provide one keyboard/focus contract for Popup dialogs

function focusableElements(dialog: HTMLElement): HTMLElement[] {
	return Array.from(dialog.querySelectorAll<HTMLElement>(
		'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), '
		+ 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
	)).filter((node) => !node.hidden
		&& node.getAttribute('aria-hidden') !== 'true'
		&& node.getClientRects().length > 0);
}

export function handleDialogKeydown(
	event: KeyboardEvent,
	dialog: HTMLElement,
	onEscape: () => void,
): void {
	if (event.key === 'Escape') {
		event.preventDefault();
		onEscape();
		return;
	}
	if (event.key !== 'Tab') return;

	const focusable = focusableElements(dialog);
	const first = focusable.at(0);
	const last = focusable.at(-1);
	if (!first || !last) {
		event.preventDefault();
		dialog.focus();
		return;
	}

	if (event.shiftKey && document.activeElement === first) {
		event.preventDefault();
		last.focus();
	} else if (!event.shiftKey && document.activeElement === last) {
		event.preventDefault();
		first.focus();
	}
}
