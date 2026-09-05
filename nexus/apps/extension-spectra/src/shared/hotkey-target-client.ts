// goal: typed client for the background-owned Popup hotkey target state

import type { HotkeyTargetState } from '@nexus/contracts';
import { sendSettingsUiRequest } from './ui-settings-spectra-client';

export async function getHotkeyTarget(): Promise<HotkeyTargetState> {
	const response = await sendSettingsUiRequest('spectra.hotkey-target.get', {});
	if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
	return response.data;
}

export async function setHotkeyTarget(tabId: number | null): Promise<HotkeyTargetState> {
	const response = await sendSettingsUiRequest('spectra.hotkey-target.set', { tabId });
	if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
	return response.data;
}
