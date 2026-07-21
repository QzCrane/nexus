import { useState, useEffect } from 'react';
import { HaloSettings, DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from '../core/settings';

export function useSettings() {
	const [settings, setSettings] = useState<HaloSettings>(DEFAULT_SETTINGS);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		// rule: track mount state so the .catch handler doesn't call setLoading on
		// an unmounted component (React warning + potential stale state write).
		let mounted = true;
		// Initial load
		chrome.storage.sync.get([SETTINGS_STORAGE_KEY]).then((result) => {
			if (!mounted) return;
			if (result[SETTINGS_STORAGE_KEY]) {
				setSettings({ ...DEFAULT_SETTINGS, ...result[SETTINGS_STORAGE_KEY] });
			}
			setLoading(false);
		}).catch(() => mounted && setLoading(false));

		// Listen for changes
		const listener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
			if (area === 'sync' && changes[SETTINGS_STORAGE_KEY]) {
				setSettings({ ...DEFAULT_SETTINGS, ...changes[SETTINGS_STORAGE_KEY].newValue });
			}
		};
		chrome.storage.onChanged.addListener(listener);
		return () => {
			mounted = false;
			chrome.storage.onChanged.removeListener(listener);
		};
	}, []);

	return { settings, loading };
}
