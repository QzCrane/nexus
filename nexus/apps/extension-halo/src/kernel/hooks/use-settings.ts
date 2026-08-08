import { useEffect, useState } from 'react';
import { subscribeHaloStorageChanges } from '../core/storage-change-bus';
import { type HaloSettings, DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from '../core/settings';

export function useSettings() {
	const [settings, setSettings] = useState<HaloSettings>(DEFAULT_SETTINGS);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let mounted = true;
		let eventRevision = 0;
		const unsubscribeStorageChanges = subscribeHaloStorageChanges((changes, area) => {
			if (!mounted || area !== 'sync') return;
			const change = changes[SETTINGS_STORAGE_KEY];
			if (!change) return;
			eventRevision += 1;
			setSettings({ ...DEFAULT_SETTINGS, ...change.newValue });
			setLoading(false);
		});

		const revisionBeforeRead = eventRevision;
		void chrome.storage.sync.get([SETTINGS_STORAGE_KEY]).then((result) => {
			if (!mounted || eventRevision !== revisionBeforeRead) return;
			if (result[SETTINGS_STORAGE_KEY]) {
				setSettings({ ...DEFAULT_SETTINGS, ...result[SETTINGS_STORAGE_KEY] });
			}
			setLoading(false);
		}).catch(() => {
			if (mounted && eventRevision === revisionBeforeRead) setLoading(false);
		});

		return () => {
			mounted = false;
			unsubscribeStorageChanges();
		};
	}, []);

	return { settings, loading };
}
