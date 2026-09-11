import { useEffect, useState, useRef } from 'react';
import { reportStorageHealth } from '../core/storage-health';
import { safeStorageGet } from '../core/safe-storage';
import { subscribeHaloStorageChanges } from '../core/storage-change-bus';
import { type HaloSettings, DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from '../core/settings';

export function useSettings() {
	const [settings, setSettings] = useState<HaloSettings>(DEFAULT_SETTINGS);
	const [loading, setLoading] = useState(true);
	const [attempt, retry] = useState(0);
	const owner = useRef(Symbol("settings-storage-health")).current;

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
			reportStorageHealth(owner, null);
		});

		const revisionBeforeRead = eventRevision;
		void safeStorageGet<Record<string, Partial<HaloSettings>>>([SETTINGS_STORAGE_KEY], {}, { area: 'sync' }).then((result) => {
			if (!mounted || eventRevision !== revisionBeforeRead) return;
			if (result[SETTINGS_STORAGE_KEY]) {
				setSettings({ ...DEFAULT_SETTINGS, ...result[SETTINGS_STORAGE_KEY] });
			}
			setLoading(false);
			reportStorageHealth(owner, null);
		}).catch(() => {
			if (mounted && eventRevision === revisionBeforeRead) {
				setLoading(false);
				reportStorageHealth(owner, 'read-error', () => retry(attempt + 1));
			}
		});

		return () => {
			mounted = false;
			unsubscribeStorageChanges();
			reportStorageHealth(owner, null);
		};
	}, [attempt, owner]);

	return { settings, loading };
}
