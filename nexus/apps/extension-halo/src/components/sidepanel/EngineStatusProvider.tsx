import type React from 'react';
import { createContext, useContext, useState, useEffect } from 'react';

export interface EngineStatus {
	smoothScroll: boolean;
	userscripts: boolean;
	clipboard: boolean;
}

const EngineStatusContext = createContext<EngineStatus>({
	smoothScroll: false,
	userscripts: false,
	clipboard: false
});

const DEFAULT_ENGINE_STATUS: EngineStatus = {
	smoothScroll: false,
	userscripts: false,
	clipboard: false,
};

export function mergeInitialEngineStatus(
	current: EngineStatus,
	initial: EngineStatus,
	eventOwnedFields: ReadonlySet<keyof EngineStatus>,
): EngineStatus {
	return {
		smoothScroll: eventOwnedFields.has('smoothScroll')
			? current.smoothScroll
			: initial.smoothScroll,
		userscripts: eventOwnedFields.has('userscripts')
			? current.userscripts
			: initial.userscripts,
		clipboard: eventOwnedFields.has('clipboard')
			? current.clipboard
			: initial.clipboard,
	};
}

/**
 * World-Class Performance Optimization: 
 * Centralized storage listener to avoid 80+ redundant components listeners.
 * Broadcasting status once per sidepanel instance.
 */
export const EngineStatusProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [status, setStatus] = useState<EngineStatus>(DEFAULT_ENGINE_STATUS);

	useEffect(() => {
		let disposed = false;
		const eventOwnedFields = new Set<keyof EngineStatus>();
		const checkAll = async () => {
			try {
				const [sync, local] = await Promise.all([
					chrome.storage.sync.get('HALO_SMOOTH_SCROLL_SETTINGS'),
					chrome.storage.local.get(['halo_userscripts', 'halo_tool_clipboard_settings'])
				]);

				if (disposed) return;
				const initialStatus: EngineStatus = {
					smoothScroll: !!sync.HALO_SMOOTH_SCROLL_SETTINGS?.enabled,
					userscripts: !!local.halo_userscripts?.globalEnabled,
					clipboard: local.halo_tool_clipboard_settings?.enabled !== false
				};
				setStatus((current) =>
					mergeInitialEngineStatus(current, initialStatus, eventOwnedFields));
			} catch {
				if (disposed) return;
				setStatus((current) =>
					mergeInitialEngineStatus(
						current,
						DEFAULT_ENGINE_STATUS,
						eventOwnedFields,
					));
			}
		};

		void checkAll();

		const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
			const smoothScrollChange = area === 'sync'
				? changes.HALO_SMOOTH_SCROLL_SETTINGS
				: undefined;
			const userscriptsChange = area === 'local'
				? changes.halo_userscripts
				: undefined;
			const clipboardChange = area === 'local'
				? changes.halo_tool_clipboard_settings
				: undefined;
			if (smoothScrollChange) eventOwnedFields.add('smoothScroll');
			if (userscriptsChange) eventOwnedFields.add('userscripts');
			if (clipboardChange) eventOwnedFields.add('clipboard');

			setStatus(prev => {
				const next = { ...prev };
				let changed = false;

				if (smoothScrollChange) {
					next.smoothScroll = !!smoothScrollChange.newValue?.enabled;
					changed = true;
				}
				if (userscriptsChange) {
					next.userscripts = !!userscriptsChange.newValue?.globalEnabled;
					changed = true;
				}
				if (clipboardChange) {
					next.clipboard = clipboardChange.newValue?.enabled !== false;
					changed = true;
				}
				return changed ? next : prev;
			});
		};

		chrome.storage.onChanged.addListener(listener);
		return () => {
			disposed = true;
			chrome.storage.onChanged.removeListener(listener);
		};
	}, []);

	return (
		<EngineStatusContext.Provider value={status}>
			{children}
		</EngineStatusContext.Provider>
	);
};

export const useEngineStatus = () => useContext(EngineStatusContext);
