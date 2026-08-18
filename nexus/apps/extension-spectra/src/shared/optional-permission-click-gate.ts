// goal: preserve direct user gestures while gating optional capabilities before existing click handlers execute
// inv: denied requests never fall through; successful requests replay exactly one click after admission

import {
	requestOptionalPermission,
	type SpectraOptionalPermission,
} from './optional-permission-admission';

export interface OptionalPermissionClickGateOptions {
	selector: string;
	permission: SpectraOptionalPermission;
	shouldGate?: (button: HTMLButtonElement) => boolean;
	onDenied?: (button: HTMLButtonElement) => void;
	onError?: (button: HTMLButtonElement, error: unknown) => void;
}

export function installOptionalPermissionClickGate({
	selector,
	permission,
	shouldGate = () => true,
	onDenied,
	onError,
}: OptionalPermissionClickGateOptions): () => void {
	let replaying = false;
	let pendingButton: HTMLButtonElement | null = null;

	const listener = (event: Event): void => {
		if (replaying || pendingButton || !(event.target instanceof Element)) return;
		const button = event.target.closest<HTMLButtonElement>(selector);
		if (!button || button.disabled || !shouldGate(button)) return;

		// Stop the existing product handler before any asynchronous boundary. The
		// permission request is invoked synchronously from this trusted click.
		event.preventDefault();
		event.stopImmediatePropagation();
		pendingButton = button;
		const previousDisabled = button.disabled;
		button.disabled = true;
		const request = requestOptionalPermission(permission);
		void request.then((granted) => {
			if (!granted) {
				onDenied?.(button);
				return;
			}
			replaying = true;
			button.disabled = previousDisabled;
			button.click();
			replaying = false;
		}).catch((error: unknown) => {
			onError?.(button, error);
		}).finally(() => {
			pendingButton = null;
			button.disabled = previousDisabled;
			replaying = false;
		});
	};

	document.addEventListener('click', listener, true);
	return () => document.removeEventListener('click', listener, true);
}
