// goal: keep Popup control failures visible and restore the last authoritative projection

import type { ControlError, ControlSnapshot } from '@nexus/contracts';
import { sendSpectraRequest } from '../../shared/ui-spectra-client';
import { showPopupToast } from '../toast';
import { applyControlSnapshot } from './messaging';
import type { CardInternalState } from './types';

function toControlError(error: unknown): ControlError {
	if (error && typeof error === 'object'
		&& typeof (error as { code?: unknown }).code === 'string'
		&& typeof (error as { message?: unknown }).message === 'string'
		&& typeof (error as { retryable?: unknown }).retryable === 'boolean') {
		return error as ControlError;
	}
	return {
		code: 'ui_control_failed',
		message: error instanceof Error ? error.message : String(error),
		retryable: true,
	};
}

function applyRefresh(state: CardInternalState, snapshot: ControlSnapshot, render: () => void): void {
	if (snapshot.tabId !== state.controlSnapshot?.tabId) return;
	applyControlSnapshot(state, snapshot, render);
}

async function refreshAuthoritativeCard(
	tabId: number,
	state: CardInternalState,
	render: () => void,
): Promise<void> {
	const response = await sendSpectraRequest(
		'spectra.control.snapshot.get',
		{ tabId },
		{ tabId },
	);
	if (!response.ok || !response.data) {
		if (!response.ok) throw new Error(response.error.message);
		return;
	}
	applyRefresh(state, response.data, render);
}

export function reportCardControlFailure(
	tabId: number,
	state: CardInternalState,
	render: () => void,
	error: unknown,
): void {
	const failure = toControlError(error);
	state.lastError = failure;
	showPopupToast(failure.message, 'error');
	void refreshAuthoritativeCard(tabId, state, render).catch(() => {
		// The original failure has already been presented. Preserve it if the
		// recovery read is unavailable instead of replacing it with an opaque
		// transport error or silently leaving an optimistic value on screen.
		state.lastError = failure;
		render();
	});
}
