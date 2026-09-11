// goal: admit Popup screenshot saving only from the explicit screenshot click gesture

import { installOptionalPermissionClickGate } from '../shared/optional-permission-click-gate';
import { showPopupToast } from './toast';
import { capturePanelSession, isCurrentPanelSession } from './side-panel/panel-session';
import { getCardRegistration } from './side-panel/registry';

export function installPopupOptionalPermissionAdmission(): () => void {
	return installOptionalPermissionClickGate({
		selector: '.sp-btn[data-action="screenshot"]',
		permission: 'downloads',
		captureIntent: () => {
			const session = capturePanelSession();
			const card = session.tabId === null ? undefined : getCardRegistration(session.tabId);
			return () => isCurrentPanelSession(session) && card !== undefined
				&& session.tabId !== null && getCardRegistration(session.tabId) === card;
		},
		onDenied: () => {
			showPopupToast('Screenshot saving needs Downloads permission.', 'error');
		},
		onError: () => {
			showPopupToast('Unable to request Downloads permission.', 'error');
		},
	});
}
