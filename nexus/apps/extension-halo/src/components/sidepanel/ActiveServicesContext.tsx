import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const BACKGROUND_TOOL_IDS = ['smooth-scroll', 'userscripts', 'clipboard'];

interface ActiveServicesContextType {
	activeServices: Set<string>;
	bgToolIds: string[];
	setServiceState: (id: string, isActive: boolean) => void;
}

const ActiveServicesContext = createContext<ActiveServicesContextType | undefined>(undefined);

import { safeStorageGet } from '../../kernel/core/safe-storage';

export const ActiveServicesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [activeServices, setActiveServices] = useState<Set<string>>(new Set());
	// Dynamic scripts list to include in background tool IDs
	const [scriptIds, setScriptIds] = useState<string[]>([]);

	// Initial Check & Storage Sync
	useEffect(() => {
		const checkState = async () => {
			const active = new Set<string>();
			const currentScriptIds: string[] = [];

			try {
				// Use storage defaults: default to TRUE if key missing
				const localData = await safeStorageGet(['halo_tool_clipboard_settings', 'halo_userscripts'], {
					halo_tool_clipboard_settings: { enabled: true },
					halo_userscripts: { globalEnabled: true, scripts: [] }
				}, 'local');

				const syncData = await safeStorageGet(['HALO_SMOOTH_SCROLL_SETTINGS'], {
					HALO_SMOOTH_SCROLL_SETTINGS: { enabled: true }
				}, 'sync');

				if (localData.halo_tool_clipboard_settings.enabled) active.add('clipboard');
				if (localData.halo_userscripts.globalEnabled) active.add('userscripts');
				if (syncData.HALO_SMOOTH_SCROLL_SETTINGS.enabled) active.add('smooth-scroll');

				// Process User Scripts
				const scripts = localData.halo_userscripts.scripts || [];
				if (localData.halo_userscripts.globalEnabled) {
					scripts.forEach((script: any) => {
						currentScriptIds.push(script.id);
						if (script.saatToolId) currentScriptIds.push(script.saatToolId);
						
						if (script.enabled) {
							active.add(script.id);
							if (script.saatToolId) active.add(script.saatToolId);
						}
					});
				} else {
					// Even if global disabled, we track IDs, but none are active
					scripts.forEach((script: any) => {
						currentScriptIds.push(script.id);
						if (script.saatToolId) currentScriptIds.push(script.saatToolId);
					});
				}

				setScriptIds(prev => JSON.stringify(prev) !== JSON.stringify(currentScriptIds) ? currentScriptIds : prev);

				setActiveServices(prev => {
					if (prev.size === active.size && [...prev].every(x => active.has(x))) return prev;
					return active;
				});
			} catch (e) {
				console.error('Failed to sync active services:', e);
			}
		};

		checkState();
	
	// Event-driven only - no polling needed, storage.onChanged is sufficient
	const listener = (changes: any, area: string) => {
		let changed = false;
		if (area === 'local' && (changes.halo_tool_clipboard_settings || changes.halo_userscripts)) changed = true;
		if (area === 'sync' && changes.HALO_SMOOTH_SCROLL_SETTINGS) changed = true;
		if (changed) checkState();
	};
	chrome.storage.onChanged.addListener(listener);

	// Visibility-based re-check when panel becomes visible again
	const onVisibilityChange = () => {
		if (document.visibilityState === 'visible') checkState();
	};
	document.addEventListener('visibilitychange', onVisibilityChange);

	return () => {
		chrome.storage.onChanged.removeListener(listener);
		document.removeEventListener('visibilitychange', onVisibilityChange);
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

	// Combine hardcoded background tools with dynamic script IDs
	const allBgToolIds = [...BACKGROUND_TOOL_IDS, ...scriptIds];

	return (
		<ActiveServicesContext.Provider value={{ activeServices, bgToolIds: allBgToolIds, setServiceState }}>
			{children}
		</ActiveServicesContext.Provider>
	);
};

export const useActiveServices = () => {
	const context = useContext(ActiveServicesContext);
	if (!context) throw new Error('useActiveServices must be used within ActiveServicesProvider');
	return context;
};
