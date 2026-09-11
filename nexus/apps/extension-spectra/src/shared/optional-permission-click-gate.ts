// goal: preserve the direct permission gesture and resume only its still-owned button intent
// inv: pending matches never bypass admission; disposal and DOM retirement invalidate continuations

import { requestOptionalPermission, type SpectraOptionalPermission } from './optional-permission-admission';

export interface OptionalPermissionClickGateOptions {
	selector: string;
	permission: SpectraOptionalPermission;
	shouldGate?: (button: HTMLButtonElement) => boolean;
	captureIntent?: (button: HTMLButtonElement) => () => boolean;
	onDenied?: (button: HTMLButtonElement) => void;
	onError?: (button: HTMLButtonElement, error: unknown) => void;
}

export function installOptionalPermissionClickGate({
	selector,
	permission,
	shouldGate = () => true,
	captureIntent = () => () => true,
	onDenied,
	onError,
}: OptionalPermissionClickGateOptions): () => void {
	let disposed = false;
	let replayButton: HTMLButtonElement | null = null;
	let pending: { button: HTMLButtonElement; restore: () => void } | null = null;

	const listener = (event: Event): void => {
		if (disposed || !(event.target instanceof Element)) return;
		const button = event.target.closest<HTMLButtonElement>(selector);
		if (!button) return;
		// Only our exact one-shot replay may cross the gate. Consume it before
		// downstream code can synchronously dispatch a different matching click.
		if (replayButton === button) { replayButton = null; return; }
		if (!shouldGate(button)) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		if (pending || button.disabled) return;

		const previousBusy = button.getAttribute('aria-busy');
		button.setAttribute('aria-busy', 'true');
		const intent = { button, restore: () => {
			if (previousBusy === null) button.removeAttribute('aria-busy');
			else button.setAttribute('aria-busy', previousBusy);
		} };
		pending = intent;
		const current = () => !disposed && pending === intent && button.isConnected;
		const settle = () => {
			intent.restore();
			if (pending === intent) pending = null;
			replayButton = null;
		};
		try {
			// Do not place an await or a contains() call ahead of the permission request.
			const ownsIntent = captureIntent(button);
			const request = requestOptionalPermission(permission);
			void request.then((granted) => {
				if (!current()) return;
				if (!granted) { onDenied?.(button); return; }
				// A reused settings modal can change its requested operation while
				// the permission prompt is open. Never replay a different intent.
				if (!ownsIntent() || !shouldGate(button) || button.disabled) return;
				intent.restore();
				replayButton = button;
				button.click();
			}).catch((error: unknown) => {
				if (current()) onError?.(button, error);
			}).finally(settle).catch((error: unknown) => {
				console.warn('[SPECTRA] Optional-permission continuation failed:', error);
			});
		} catch (error) {
			try { if (current()) onError?.(button, error); } finally { settle(); }
		}
	};

	document.addEventListener('click', listener, true);
	return () => {
		if (disposed) return;
		disposed = true;
		document.removeEventListener('click', listener, true);
		pending?.restore();
		pending = null;
		replayButton = null;
	};
}
