// goal: acquire screenshot permission while the Options Save click still owns a user gesture

import { installOptionalPermissionClickGate } from '../shared/optional-permission-click-gate';
import { captureModalSaveIntent } from './modal';

function screenshotSelected(): boolean {
	const action = document.getElementById('edit-action');
	if (!(action instanceof HTMLSelectElement)) return false;
	action.setCustomValidity('');
	return action.value === 'screenshot';
}

function showDownloadsAdmissionFailure(message: string): void {
	const action = document.getElementById('edit-action');
	if (!(action instanceof HTMLSelectElement)) return;
	action.setCustomValidity(message);
	action.reportValidity();
}

export function installOptionsOptionalPermissionAdmission(): () => void {
	return installOptionalPermissionClickGate({
		selector: '#modal-save',
		permission: 'downloads',
		shouldGate: screenshotSelected,
	captureIntent: captureModalSaveIntent,
		onDenied: () => showDownloadsAdmissionFailure('Downloads permission is required for Screenshot hotkeys.'),
		onError: () => showDownloadsAdmissionFailure('Unable to request Downloads permission.'),
	});
}
