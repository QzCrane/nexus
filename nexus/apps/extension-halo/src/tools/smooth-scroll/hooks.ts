// goal: Logic hooks for SmoothScrollPanel
// eff: Encapsulate settings management

import { useState, useCallback, useEffect } from 'react';
import { createLogger } from '@nexus/kernel';
import { useToolState } from '../../kernel';
import { useTranslation } from '../../i18n';
import type { ScrollSettings } from './types';
import { DEFAULT_SETTINGS, PROFILES, CUSTOM_PROFILE_KEY, STORAGE_KEY } from './types';
import { useToast } from '../../components/ToastProvider';

const logger = createLogger('SmoothScroll', 'HALO');

export function useSmoothScrollSettings() {
	const { t } = useTranslation();
	const { showToast } = useToast();
	// Use sync storage with custom key for backward compatibility
	const [settings, setSettings] = useToolState<ScrollSettings>(
		'smooth-scroll',
		DEFAULT_SETTINGS,
		{ area: 'sync', storageKey: STORAGE_KEY }
	);
	// const [toast, setToast] = useState<string | null>(null); // Removed locally
	const [hasCustomProfile, setHasCustomProfile] = useState(false);

	// useEffect(() => { loadSettings().then(setSettings); }, []); // useToolState handles parsing

	useEffect(() => {
		chrome.storage.sync.get([CUSTOM_PROFILE_KEY], (r) => {
			setHasCustomProfile(!!r[CUSTOM_PROFILE_KEY]);
		});
	}, []);

	// const showToast = ... // Removed local implementation

	const updateSetting = useCallback(<K extends keyof ScrollSettings>(key: K, value: ScrollSettings[K]) => {
		setSettings(prev => ({ ...prev, [key]: value }));
		logger.info(`Setting updated: ${key}`, value);
	}, [setSettings]);


	const loadProfile = useCallback(async (profileName: keyof typeof PROFILES) => {
		const profile = PROFILES[profileName];
		setSettings(prev => ({ ...prev, ...profile }));
		showToast(`${t(`smoothScroll.profilesList.${profileName}`, { defaultValue: profileName })} ${t('smoothScroll.toasts.loaded')}`);
	}, [showToast, t, setSettings]);


	const loadCustomProfile = useCallback(async () => {
		const r = await chrome.storage.sync.get([CUSTOM_PROFILE_KEY]);
		if (r[CUSTOM_PROFILE_KEY]) {
			setSettings(prev => ({ ...prev, ...r[CUSTOM_PROFILE_KEY] }));
			showToast(`${t('smoothScroll.profilesList.custom')} ${t('smoothScroll.toasts.loaded')}`);
		}
	}, [showToast, t, setSettings]);


	const saveAsCustom = useCallback(async () => {
		await chrome.storage.sync.set({ [CUSTOM_PROFILE_KEY]: settings });
		setHasCustomProfile(true);
		showToast(t('smoothScroll.toasts.savedCustom'));
		logger.info('Custom profile saved');
	}, [settings, showToast, t]);

	const resetSettings = useCallback(() => {
		setSettings(DEFAULT_SETTINGS);
		showToast(t('smoothScroll.toasts.reset'));
		logger.info('Settings reset to defaults');
	}, [showToast, t, setSettings]);


	return {
		settings,
		setSettings,
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
