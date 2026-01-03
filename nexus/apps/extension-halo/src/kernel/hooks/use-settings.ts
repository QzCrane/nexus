import { useState, useEffect } from 'react';
import { HaloSettings, DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from '../core/settings';

export function useSettings() {
	const [settings, setSettings] = useState<HaloSettings>(DEFAULT_SETTINGS);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		// Initial load
		chrome.storage.sync.get([SETTINGS_STORAGE_KEY]).then((result) => {
			if (result[SETTINGS_STORAGE_KEY]) {
				setSettings({ ...DEFAULT_SETTINGS, ...result[SETTINGS_STORAGE_KEY] });
			}
			setLoading(false);
		});

		// Listen for changes
		const listener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
			if (area === 'sync' && changes[SETTINGS_STORAGE_KEY]) {
				setSettings({ ...DEFAULT_SETTINGS, ...changes[SETTINGS_STORAGE_KEY].newValue });
			}
		};
		chrome.storage.onChanged.addListener(listener);
		return () => chrome.storage.onChanged.removeListener(listener);
	}, []);

	return { settings, loading };
}
