/**
 * SPECTRA Popup - Side Panel Footer Actions
 * Reset/Save effect presets (EQ/Pan/Delay).
 * Note: Independent of main UI card volume presets.
 */

import { DEFAULT_AUDIO_CONFIG } from '@nexus/kernel';
import { getCurrentPanelTabId, getCardRegistration } from './index';
import { syncSidePanelState } from './controls';

/** Effect Preset prefix */
const FX_PRESET_PREFIX = 'preset_fx_';

export function bindFooterActions(): void {
	const btnReset = document.querySelector('.sp-btn-reset') as HTMLButtonElement | null;
	const btnSave = document.querySelector('.sp-btn-save') as HTMLButtonElement | null;

	btnReset?.addEventListener('click', handleReset);
	btnSave?.addEventListener('click', handleSave);
}

/** Reset: Restore effects to default (preserve volume) */
function handleReset(): void {
	const tabId = getCurrentPanelTabId();
	if (tabId === null) return;

	const reg = getCardRegistration(tabId);
	if (!reg) return;

	const resetValues = {
		eqValues: [...DEFAULT_AUDIO_CONFIG.eqValues],
		pan: DEFAULT_AUDIO_CONFIG.pan,
		delay: DEFAULT_AUDIO_CONFIG.delay,
	};

	reg.update(resetValues);

	const newConfig = { ...reg.getConfig(), ...resetValues };
	syncSidePanelState(newConfig);
}

/** Save: Store effect config to domain preset */
async function handleSave(): Promise<void> {
	const tabId = getCurrentPanelTabId();
	if (tabId === null) return;

	const reg = getCardRegistration(tabId);
	if (!reg) return;

	const domain = await getDomainForTab(tabId);
	if (!domain) return;

	const config = reg.getConfig();
	// Only save effects
	const fxPreset = {
		eqValues: config.eqValues,
		pan: config.pan,
		delay: config.delay,
	};

	const key = `${FX_PRESET_PREFIX}${domain}`;
	await chrome.storage.local.set({ [key]: fxPreset });
}

/**
 * Load FX Preset (called by openSidePanel)
 */
export async function loadFxPreset(domain: string): Promise<{
	eqValues?: number[];
	pan?: number;
	delay?: number;
} | null> {
	const key = `${FX_PRESET_PREFIX}${domain}`;
	const result = await chrome.storage.local.get([key]);
	return result[key] || null;
}

async function getDomainForTab(tabId: number): Promise<string | null> {
	try {
		const tab = await chrome.tabs.get(tabId);
		if (!tab?.url) return null;
		return new URL(tab.url).hostname.replace('www.', '');
	} catch {
		return null;
	}
}
