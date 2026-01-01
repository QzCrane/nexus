import React, { createContext, useContext, useState, useEffect } from 'react';

interface EngineStatus {
	smoothScroll: boolean;
	userscripts: boolean;
	clipboard: boolean;
}

const EngineStatusContext = createContext<EngineStatus>({
	smoothScroll: false,
	userscripts: false,
	clipboard: false
});

/**
 * World-Class Performance Optimization: 
 * Centralized storage listener to avoid 80+ redundant components listeners.
 * Broadcasting status once per sidepanel instance.
 */
export const EngineStatusProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [status, setStatus] = useState<EngineStatus>({
		smoothScroll: false,
		userscripts: false,
		clipboard: false
	});

	useEffect(() => {
		const checkAll = async () => {
			const [sync, local] = await Promise.all([
				chrome.storage.sync.get('HALO_SMOOTH_SCROLL_SETTINGS'),
				chrome.storage.local.get(['halo_userscripts', 'halo_tool_clipboard_settings'])
			]);

			setStatus({
				smoothScroll: !!sync['HALO_SMOOTH_SCROLL_SETTINGS']?.enabled,
				userscripts: !!local['halo_userscripts']?.globalEnabled,
				clipboard: local['halo_tool_clipboard_settings']?.enabled !== false
			});
		};

		checkAll();

		const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
			setStatus(prev => {
				const next = { ...prev };
				let changed = false;

				if (area === 'sync' && changes['HALO_SMOOTH_SCROLL_SETTINGS']) {
					next.smoothScroll = !!changes['HALO_SMOOTH_SCROLL_SETTINGS'].newValue?.enabled;
					changed = true;
				}
				if (area === 'local') {
					if (changes['halo_userscripts']) {
						next.userscripts = !!changes['halo_userscripts'].newValue?.globalEnabled;
						changed = true;
					}
					if (changes['halo_tool_clipboard_settings']) {
						next.clipboard = changes['halo_tool_clipboard_settings'].newValue?.enabled !== false;
						changed = true;
					}
				}
				return changed ? next : prev;
			});
		};

		chrome.storage.onChanged.addListener(listener);
		return () => chrome.storage.onChanged.removeListener(listener);
	}, []);

	return (
		<EngineStatusContext.Provider value={status}>
			{children}
		</EngineStatusContext.Provider>
	);
};

export const useEngineStatus = () => useContext(EngineStatusContext);
