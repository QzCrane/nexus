import { useState, useEffect } from 'react';

export const BACKGROUND_TOOL_IDS = ['smooth-scroll', 'userscripts', 'clipboard'];

export function useActiveServices() {
	const [activeServices, setActiveServices] = useState<Set<string>>(new Set());

	useEffect(() => {
		const checkState = async () => {
			const active = new Set<string>();

			try {
				// 1. Storage Defaults
				const localData = await chrome.storage.local.get({
					halo_tool_clipboard_settings: { enabled: true },
					halo_userscripts: { globalEnabled: true }
				});
				const syncData = await chrome.storage.sync.get({
					HALO_SMOOTH_SCROLL_SETTINGS: { enabled: true }
				});

				if (localData.halo_tool_clipboard_settings.enabled) active.add('clipboard');
				if (localData.halo_userscripts.globalEnabled) active.add('userscripts');
				if (syncData.HALO_SMOOTH_SCROLL_SETTINGS.enabled) active.add('smooth-scroll');

				setActiveServices(prev => {
					if (prev.size === active.size && [...prev].every(x => active.has(x))) {
						return prev;
					}
					return active;
				});
			} catch (e) {
				console.error('[ActiveServices] Check failed', e);
			}
		};

		checkState();

		const listener = (changes: any, area: string) => {
			let changed = false;
			if (area === 'local') {
				if (changes.halo_tool_clipboard_settings || changes.halo_userscripts) changed = true;
			}
			if (area === 'sync') {
				if (changes.HALO_SMOOTH_SCROLL_SETTINGS) changed = true;
			}
			if (changed) checkState();
		};

		chrome.storage.onChanged.addListener(listener);

		// Polling fallback every 2s to handle any missed events or discrepancies
		const interval = setInterval(checkState, 2000);

		return () => {
			chrome.storage.onChanged.removeListener(listener);
			clearInterval(interval);
		};
	}, []);

	return { activeServices, BACKGROUND_TOOL_IDS };
}
