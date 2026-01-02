import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const BACKGROUND_TOOL_IDS = ['smooth-scroll', 'userscripts', 'clipboard'];

interface ActiveServicesContextType {
	activeServices: Set<string>;
	bgToolIds: string[];
	setServiceState: (id: string, isActive: boolean) => void;
}

const ActiveServicesContext = createContext<ActiveServicesContextType | undefined>(undefined);

export const ActiveServicesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [activeServices, setActiveServices] = useState<Set<string>>(new Set());

	// Initial Check & Storage Sync
	useEffect(() => {
		const checkState = async () => {
			const active = new Set<string>();
			try {
				// Use storage defaults: default to TRUE if key missing
				const localData = await chrome.storage.local.get({
					halo_tool_clipboard_settings: { enabled: true },
					halo_userscripts: { globalEnabled: true }
				});

				const syncData = await chrome.storage.sync.get({
					'halo_tool_state_smooth-scroll': { enabled: true }
				});

				if (localData.halo_tool_clipboard_settings.enabled) active.add('clipboard');
				if (localData.halo_userscripts.globalEnabled) active.add('userscripts');
				if (syncData['halo_tool_state_smooth-scroll'].enabled) active.add('smooth-scroll');


				setActiveServices(prev => {
					if (prev.size === active.size && [...prev].every(x => active.has(x))) return prev;
					return active;
				});
			} catch (e) {
				console.error('Failed to sync active services:', e);
			}
		};

		checkState();
		
		const listener = (changes: any, area: string) => {
			let changed = false;
			if (area === 'local' && (changes.halo_tool_clipboard_settings || changes.halo_userscripts)) changed = true;
			if (area === 'sync' && changes['halo_tool_state_smooth-scroll']) changed = true;
			if (changed) checkState();

		};
		chrome.storage.onChanged.addListener(listener);
		const interval = setInterval(checkState, 2000);

		return () => {
			chrome.storage.onChanged.removeListener(listener);
			clearInterval(interval);
		};
	}, []);

	// Fast update function for UI switches
	const setServiceState = useCallback((id: string, isActive: boolean) => {
		setActiveServices(prev => {
			const next = new Set(prev);
			if (isActive) next.add(id);
			else next.delete(id);
			return next;
		});
	}, []);

	return (
		<ActiveServicesContext.Provider value={{ activeServices, bgToolIds: BACKGROUND_TOOL_IDS, setServiceState }}>
			{children}
		</ActiveServicesContext.Provider>
	);
};

export const useActiveServices = () => {
	const context = useContext(ActiveServicesContext);
	if (!context) throw new Error('useActiveServices must be used within ActiveServicesProvider');
	return context;
};
