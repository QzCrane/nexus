// goal: Logic hooks for SmoothScrollPanel
// eff: Encapsulate settings management

import { useState, useCallback, useEffect } from 'react';
import { createLogger } from '@nexus/kernel';
import { useToolState } from '../../kernel';
import { useTranslation } from '../../i18n';
import type { ScrollSettings } from './types';
import { DEFAULT_SETTINGS, PROFILES, STORAGE_KEY, normalizeScrollSettings } from './types';
import { loadCustomProfile as readCustomProfile, saveCustomProfile } from './core';
import { useToast } from '../../components/ToastProvider';

const logger = createLogger('SmoothScroll', 'HALO');

export function useSmoothScrollSettings() {
	const { t } = useTranslation();
	const { showToast } = useToast();
	// Use sync storage with custom key for backward compatibility
	const [settings, setSettings] = useToolState<ScrollSettings>(
		'smooth-scroll',
		DEFAULT_SETTINGS,
		{
			area: 'sync',
			storageKey: STORAGE_KEY,
			debounceMs: 0,
			normalize: normalizeScrollSettings,
		}
	);
	const [hasCustomProfile, setHasCustomProfile] = useState(false);

	useEffect(() => {
		let active = true;
		void readCustomProfile().then((profile) => { if (active) setHasCustomProfile(profile !== null); })
			.catch((error: unknown) => logger.error('Custom profile load failed', error));
		return () => { active = false; };
	}, []);

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
		try {
			const profile = await readCustomProfile();
			if (profile) {
				setSettings(profile);
				showToast(`${t('smoothScroll.profilesList.custom')} ${t('smoothScroll.toasts.loaded')}`);
			}
		} catch (error: unknown) {
			showToast(t('smoothScroll.toasts.importFailed'));
			logger.error('Custom profile load failed', error);
		}
	}, [showToast, t, setSettings]);


	const saveAsCustom = useCallback(async () => {
		try {
			await saveCustomProfile(settings);
			setHasCustomProfile(true);
			showToast(t('smoothScroll.toasts.savedCustom'));
			logger.info('Custom profile saved');
		} catch (error: unknown) {
			showToast(t('smoothScroll.toasts.importFailed'));
			logger.error('Custom profile save failed', error);
		}
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
