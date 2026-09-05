// goal: manages the reset and persistence of advanced effect presets (EQ, Pan, Delay) in the side panel

import { DEFAULT_AUDIO_CONFIG } from '@nexus/contracts';
import { capturePanelSession, isCurrentPanelSession } from './panel-session';
import { getCardRegistration } from './registry';
import { syncSidePanelState } from './controls';
import { patchSettings } from '../../shared/settings-client';
import { showPopupToast } from '../toast';

export function bindFooterActions(): void {
	const btnReset = document.querySelector('.sp-btn-reset') as HTMLButtonElement | null;
	const btnSave = document.querySelector('.sp-btn-save') as HTMLButtonElement | null;

	if (btnReset) btnReset.onclick = () => { void handleReset(); };
	if (btnSave) btnSave.onclick = () => { void handleSave(); };
}

export function unbindFooterActions(): void {
	const btnReset = document.querySelector('.sp-btn-reset') as HTMLButtonElement | null;
	const btnSave = document.querySelector('.sp-btn-save') as HTMLButtonElement | null;
	if (btnReset) btnReset.onclick = null;
	if (btnSave) btnSave.onclick = null;
}

// eff: reverts the side panel's effect settings to factory defaults while preserving the current tab's volume level
async function handleReset(): Promise<void> {
	const panelSession = capturePanelSession();
	const tabId = panelSession.tabId;
	if (tabId === null) return;

	const reg = getCardRegistration(tabId);
	if (!reg) return;

	const resetValues = {
		eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
		pan: DEFAULT_AUDIO_CONFIG.pan,
		delay: DEFAULT_AUDIO_CONFIG.delay,
	};

	try {
		reg.update(resetValues);
		await reg.flush?.();
		if (!isCurrentPanelSession(panelSession)) return;
		const newConfig = { ...reg.getConfig(), ...resetValues };
		syncSidePanelState(newConfig);
	} catch (error: unknown) {
		if (isCurrentPanelSession(panelSession)) {
			showPopupToast(error instanceof Error ? error.message : String(error), 'error');
		}
	}
}

// eff: captures only the effect-related values from the current tab and saves them as a domain-specific preset
async function handleSave(): Promise<void> {
	const panelSession = capturePanelSession();
	const tabId = panelSession.tabId;
	if (tabId === null) return;

	const reg = getCardRegistration(tabId);
	if (!reg) return;

	try {
		const domain = await getDomainForTab(tabId);
		if (!domain) throw new Error('The current tab domain is unavailable');
		if (!isCurrentPanelSession(panelSession)) return;
		// Do not persist optimistic effect values. The card transport owns the
		// ACK/rollback boundary, so Save Effects must drain it first.
		await reg.flush?.();
		if (!isCurrentPanelSession(panelSession)) return;

		const config = reg.getConfig();
		// rule: exclude persistent volume/mute state to prevent jarring jumps when presets are reused across sessions
		const fxPreset = {
			eqValues: [...config.eqValues],
			pan: config.pan,
			delay: config.delay,
		};

		await patchSettings({
			scope: 'audio-site',
			domain,
			value: fxPreset,
			mode: 'merge',
		});
	} catch (error: unknown) {
		if (isCurrentPanelSession(panelSession)) {
			showPopupToast(error instanceof Error ? error.message : String(error), 'error');
		}
	}
}

async function getDomainForTab(tabId: number): Promise<string | null> {
	try {
		const tab = await chrome.tabs.get(tabId);
		if (!tab?.url) return null;
		return new URL(tab.url).hostname;
	} catch {
		return null;
	}
}
