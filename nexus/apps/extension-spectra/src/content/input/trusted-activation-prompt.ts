// goal: bridge Popup-to-page activation with one explicit, bounded trusted click

import { showActionToast, showToast } from '../ui/toast';
import { submitTrustedActivationControl } from './hotkey-helpers';

let disposePrompt: (() => void) | null = null;

export function armTrustedActivationPrompt(field: 'pip', label: string): void {
	disposePrompt?.();
	disposePrompt = showActionToast(label, () => {
		disposePrompt = null;
		// Invocation begins inside the trusted click stack. The native browser API
		// runs before the first await; only its acknowledged actual state is routed later.
		void submitTrustedActivationControl(field).catch((error: unknown) => {
			showToast(error instanceof Error ? error.message : String(error));
		});
	});
}

export function disposeTrustedActivationPrompt(): void {
	disposePrompt?.();
	disposePrompt = null;
}
