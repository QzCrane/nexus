// goal: Logic hooks for SmoothScrollPanel
// eff: Encapsulate settings management

import { useState, useCallback, useEffect } from 'react';
import { createLogger } from '@nexus/kernel';
import { useTranslation } from '../../i18n';
import type { ScrollSettings } from './types';
import { DEFAULT_SETTINGS, PROFILES, STORAGE_KEY, CUSTOM_PROFILE_KEY } from './types';
import { loadSettings, saveSettings, broadcastSettings } from './core';

const logger = createLogger('SmoothScroll', 'HALO');

export function useSmoothScrollSettings() {
	const { t } = useTranslation();
	const [settings, setSettings] = useState<ScrollSettings>(DEFAULT_SETTINGS);
	const [toast, setToast] = useState<string | null>(null);
	const [hasCustomProfile, setHasCustomProfile] = useState(false);

	useEffect(() => { loadSettings().then(setSettings); }, []);
	useEffect(() => {
		chrome.storage.sync.get([CUSTOM_PROFILE_KEY], (r) => {
			setHasCustomProfile(!!r[CUSTOM_PROFILE_KEY]);
		});
	}, []);

	const showToast = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast(null), 1200); }, []);

	const updateSetting = useCallback(async <K extends keyof ScrollSettings>(key: K, value: ScrollSettings[K]) => {
		const updated = await saveSettings({ [key]: value });
		setSettings(updated);
		await broadcastSettings(updated);
		logger.info(`Setting updated: ${key}`, value);
	}, []);

	const loadProfile = useCallback(async (profileName: keyof typeof PROFILES) => {
		const profile = PROFILES[profileName];
		const updated = await saveSettings(profile);
		setSettings(updated);
		await broadcastSettings(updated);
		showToast(`${t(`smoothScroll.profilesList.${profileName}` as any)} ${t('smoothScroll.toasts.loaded')}`);
	}, [showToast, t]);

	const loadCustomProfile = useCallback(async () => {
		const r = await chrome.storage.sync.get([CUSTOM_PROFILE_KEY]);
		if (r[CUSTOM_PROFILE_KEY]) {
			const updated = await saveSettings(r[CUSTOM_PROFILE_KEY]);
			setSettings(updated);
			await broadcastSettings(updated);
			showToast(`${t('smoothScroll.profilesList.custom')} ${t('smoothScroll.toasts.loaded')}`);
		}
	}, [showToast, t]);

	const saveAsCustom = useCallback(async () => {
		await chrome.storage.sync.set({ [CUSTOM_PROFILE_KEY]: settings });
		setHasCustomProfile(true);
		showToast(t('smoothScroll.toasts.savedCustom'));
		logger.info('Custom profile saved');
	}, [settings, showToast, t]);

	const resetSettings = useCallback(async () => {
		await chrome.storage.sync.set({ [STORAGE_KEY]: DEFAULT_SETTINGS });
		setSettings(DEFAULT_SETTINGS);
		await broadcastSettings(DEFAULT_SETTINGS);
		showToast(t('smoothScroll.toasts.reset'));
		logger.info('Settings reset to defaults');
	}, [showToast, t]);

	return {
		settings,
		setSettings,
		toast,
		showToast,
		hasCustomProfile,
		updateSetting,
		loadProfile,
		loadCustomProfile,
		saveAsCustom,
		resetSettings,
		t,
	};
}
