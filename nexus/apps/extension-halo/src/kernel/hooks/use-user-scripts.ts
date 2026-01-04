// goal: Hook to access user scripts from storage
// eff: Provides real-time list of scripts for Launcher integration

import { useState, useEffect } from 'react';
import type { SaaTScriptState } from '../services/saat-types';

const USERSCRIPTS_STORAGE_KEY = 'halo_userscripts';

export function useUserScripts() {
	const [scripts, setScripts] = useState<SaaTScriptState[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		const loadScripts = async () => {
			try {
				const result = await chrome.storage.local.get(USERSCRIPTS_STORAGE_KEY);
				const state = result[USERSCRIPTS_STORAGE_KEY] || { scripts: [] };
				setScripts(state.scripts || []);
			} catch (e) {
				console.error('Failed to load user scripts:', e);
			} finally {
				setLoading(false);
			}
		};

		loadScripts();

		// Listen for changes
		const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
			if (changes[USERSCRIPTS_STORAGE_KEY]) {
				const newState = changes[USERSCRIPTS_STORAGE_KEY].newValue || { scripts: [] };
				setScripts(newState.scripts || []);
			}
		};

		chrome.storage.onChanged.addListener(listener);
		return () => chrome.storage.onChanged.removeListener(listener);
	}, []);

	return { scripts, loading };
}
