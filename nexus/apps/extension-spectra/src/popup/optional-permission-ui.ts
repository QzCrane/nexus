// goal: admit Popup screenshot saving only from the explicit screenshot click gesture

import { installOptionalPermissionClickGate } from '../shared/optional-permission-click-gate';
import { showPopupToast } from './toast';

export function installPopupOptionalPermissionAdmission(): () => void {
	return installOptionalPermissionClickGate({
		selector: '.sp-btn[data-action="screenshot"]',
		permission: 'downloads',
		onDenied: () => {
			showPopupToast('Screenshot saving needs Downloads permission.', 'error');
		},
		onError: () => {
			showPopupToast('Unable to request Downloads permission.', 'error');
		},
	});
}
