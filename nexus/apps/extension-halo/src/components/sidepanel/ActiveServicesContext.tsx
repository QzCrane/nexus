import type React from 'react';
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { subscribeHaloStorageChanges } from '../../kernel/core/storage-change-bus';
import {
	BACKGROUND_ACTIVE_ONLY_MAP,
	BACKGROUND_PLUGIN_IDS,
} from '../../kernel/registry/_generated-background-active';
import {
	getUserScriptsStorageSnapshot,
	subscribeUserScriptsStorage,
} from '../../system/userscripts/storage-authority';

interface ActiveServiceScript {
	id: string;
	enabled: boolean;
	saatToolId?: string;
}

export interface ActiveServiceStorageState {
	ready: boolean;
	clipboardEnabled: boolean;
	hoverZoomEnabled: boolean;
	userscriptsEnabled: boolean;
	smoothScrollEnabled: boolean;
	userScripts: ActiveServiceScript[];
	saatScripts: ActiveServiceScript[];
}

type RuntimeStorageField = Exclude<keyof ActiveServiceStorageState, 'ready'>;

const EMPTY_STORAGE_STATE: ActiveServiceStorageState = {
	ready: false,
	clipboardEnabled: false,
	hoverZoomEnabled: false,
	userscriptsEnabled: false,
	smoothScrollEnabled: false,
	userScripts: [],
	saatScripts: [],
};

const TRUE_BACKGROUND_IDS = BACKGROUND_PLUGIN_IDS.filter(
	(id) => BACKGROUND_ACTIVE_ONLY_MAP[id] === false,
);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isActiveServiceScript(value: unknown): value is ActiveServiceScript {
	if (!isRecord(value)) return false;
	return typeof value.id === 'string'
		&& typeof value.enabled === 'boolean'
		&& (value.saatToolId === undefined || typeof value.saatToolId === 'string');
}

function readScripts(value: unknown): ActiveServiceScript[] {
	if (!isRecord(value) || !Array.isArray(value.scripts)) return [];
	return value.scripts.filter(isActiveServiceScript);
}

function readEnabled(value: unknown, fallback = true): boolean {
	if (!isRecord(value) || typeof value.enabled !== 'boolean') return fallback;
	return value.enabled;
}

function sameScripts(left: readonly ActiveServiceScript[], right: readonly ActiveServiceScript[]): boolean {
	return left.length === right.length && left.every((item, index) => {
		const candidate = right[index];
		return candidate?.id === item.id
			&& candidate.enabled === item.enabled
			&& candidate.saatToolId === item.saatToolId;
	});
}

function sameStorageState(left: ActiveServiceStorageState, right: ActiveServiceStorageState): boolean {
	return left.ready === right.ready
		&& left.clipboardEnabled === right.clipboardEnabled
		&& left.hoverZoomEnabled === right.hoverZoomEnabled
		&& left.userscriptsEnabled === right.userscriptsEnabled
		&& left.smoothScrollEnabled === right.smoothScrollEnabled
		&& sameScripts(left.userScripts, right.userScripts)
		&& sameScripts(left.saatScripts, right.saatScripts);
}

export function mergeInitialActiveServiceStorageState(
	current: ActiveServiceStorageState,
	initial: ActiveServiceStorageState,
	eventOwnedFields: ReadonlySet<RuntimeStorageField>,
): ActiveServiceStorageState {
	const merged: ActiveServiceStorageState = {
		ready: true,
		clipboardEnabled: eventOwnedFields.has('clipboardEnabled')
			? current.clipboardEnabled
			: initial.clipboardEnabled,
		hoverZoomEnabled: eventOwnedFields.has('hoverZoomEnabled')
			? current.hoverZoomEnabled
			: initial.hoverZoomEnabled,
		userscriptsEnabled: eventOwnedFields.has('userscriptsEnabled')
			? current.userscriptsEnabled
			: initial.userscriptsEnabled,
		smoothScrollEnabled: eventOwnedFields.has('smoothScrollEnabled')
			? current.smoothScrollEnabled
			: initial.smoothScrollEnabled,
		userScripts: eventOwnedFields.has('userScripts') ? current.userScripts : initial.userScripts,
		saatScripts: eventOwnedFields.has('saatScripts') ? current.saatScripts : initial.saatScripts,
	};
	return sameStorageState(current, merged) ? current : merged;
}

function initialStorageState(
	local: Record<string, unknown>,
	sync: Record<string, unknown>,
): ActiveServiceStorageState {
	return {
		ready: true,
		clipboardEnabled: readEnabled(local.halo_tool_clipboard_settings),
		hoverZoomEnabled: readEnabled(local.halo_hover_zoom_settings),
		userscriptsEnabled: false,
		smoothScrollEnabled: readEnabled(sync.HALO_SMOOTH_SCROLL_SETTINGS),
		userScripts: [],
		saatScripts: readScripts(local.halo_saat_scripts),
	};
}

function applyStorageChanges(
	current: ActiveServiceStorageState,
	changes: Record<string, chrome.storage.StorageChange>,
	area: string,
	eventOwnedFields: Set<RuntimeStorageField>,
): ActiveServiceStorageState {
	let next = current;
	const patch = (field: RuntimeStorageField, value: ActiveServiceStorageState[RuntimeStorageField]) => {
		eventOwnedFields.add(field);
		if (next[field] === value) return;
		next = { ...next, [field]: value };
	};

	if (area === 'local') {
		const clipboard = changes.halo_tool_clipboard_settings;
		if (clipboard) patch('clipboardEnabled', readEnabled(clipboard.newValue));

		const hoverZoom = changes.halo_hover_zoom_settings;
		if (hoverZoom) patch('hoverZoomEnabled', readEnabled(hoverZoom.newValue));

		const saat = changes.halo_saat_scripts;
		if (saat) {
			const scripts = readScripts(saat.newValue);
			eventOwnedFields.add('saatScripts');
			if (!sameScripts(next.saatScripts, scripts)) next = { ...next, saatScripts: scripts };
		}
	}

	if (area === 'sync') {
		const smoothScroll = changes.HALO_SMOOTH_SCROLL_SETTINGS;
		if (smoothScroll) patch('smoothScrollEnabled', readEnabled(smoothScroll.newValue));
	}

	return next;
}

function hasRelevantStorageChange(
	changes: Record<string, chrome.storage.StorageChange>,
	area: string,
): boolean {
	if (area === 'local') {
		return Boolean(
			changes.halo_tool_clipboard_settings
			|| changes.halo_hover_zoom_settings
			|| changes.halo_saat_scripts,
		);
	}
	return area === 'sync' && Boolean(changes.HALO_SMOOTH_SCROLL_SETTINGS);
}

function deriveActiveServices(state: ActiveServiceStorageState): Set<string> {
	const active = new Set<string>();
	if (!state.ready) return active;

	if (state.clipboardEnabled) active.add('clipboard');
	if (state.hoverZoomEnabled) active.add('hover-zoom');
	if (state.userscriptsEnabled) active.add('userscripts');
	if (state.smoothScrollEnabled) active.add('smooth-scroll');

	for (const script of state.userScripts) {
		if (!state.userscriptsEnabled || !script.enabled) continue;
		active.add(script.id);
		if (script.saatToolId) active.add(script.saatToolId);
	}
	for (const script of state.saatScripts) {
		if (script.enabled && script.saatToolId) active.add(script.saatToolId);
	}
	return active;
}

function deriveScriptIds(state: ActiveServiceStorageState): string[] {
	if (!state.ready) return [];
	const ids: string[] = [];
	for (const script of state.userScripts) {
		ids.push(script.id);
		if (script.saatToolId) ids.push(script.saatToolId);
	}
	return ids;
}

interface ActiveServicesContextType {
	activeServices: Set<string>;
	bgToolIds: string[];
}

const ActiveServicesContext = createContext<ActiveServicesContextType | undefined>(undefined);

/**
 * SidePanel status projection. Physical storage-change delivery is multiplexed
 * with the UserScripts authority so this provider does not register a second
 * chrome.storage.onChanged listener in the same JS context.
 */
export const ActiveServicesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [storageState, setStorageState] = useState<ActiveServiceStorageState>(EMPTY_STORAGE_STATE);
	const userScriptsSnapshot = useSyncExternalStore(
		subscribeUserScriptsStorage,
		getUserScriptsStorageSnapshot,
		getUserScriptsStorageSnapshot,
	);

	useEffect(() => {
		let disposed = false;
		const eventOwnedFields = new Set<RuntimeStorageField>();

		const listener = (
			changes: Record<string, chrome.storage.StorageChange>,
			area: string,
		) => {
			if (disposed || !hasRelevantStorageChange(changes, area)) return;
			setStorageState((current) => applyStorageChanges(current, changes, area, eventOwnedFields));
		};
		const unsubscribeStorageChanges = subscribeHaloStorageChanges(listener);

		void Promise.all([
			chrome.storage.local.get([
				'halo_tool_clipboard_settings',
				'halo_hover_zoom_settings',
				'halo_saat_scripts',
			]),
			chrome.storage.sync.get('HALO_SMOOTH_SCROLL_SETTINGS'),
		]).then(([local, sync]) => {
			if (disposed) return;
			const initial = initialStorageState(local, sync);
			setStorageState((current) =>
				mergeInitialActiveServiceStorageState(current, initial, eventOwnedFields));
		}).catch((error: unknown) => {
			if (disposed) return;
			console.error('[HALO:RuntimeStatus] Initial storage hydration failed', error);
			setStorageState((current) => current.ready ? current : { ...current, ready: true });
		});

		return () => {
			disposed = true;
			unsubscribeStorageChanges();
		};
	}, []);

	const userScripts = useMemo<ActiveServiceScript[]>(
		() => userScriptsSnapshot.scripts.map((script) => ({
			id: script.id,
			enabled: script.enabled,
			...(script.saatToolId ? { saatToolId: script.saatToolId } : {}),
		})),
		[userScriptsSnapshot.scripts],
	);
	const combinedState = useMemo<ActiveServiceStorageState>(() => ({
		...storageState,
		ready: storageState.ready && userScriptsSnapshot.ready,
		userscriptsEnabled: userScriptsSnapshot.globalEnabled,
		userScripts,
	}), [storageState, userScriptsSnapshot.ready, userScriptsSnapshot.globalEnabled, userScripts]);

	const activeServices = useMemo(() => deriveActiveServices(combinedState), [combinedState]);
	const bgToolIds = useMemo(
		() => [...TRUE_BACKGROUND_IDS, ...deriveScriptIds(combinedState)],
		[combinedState],
	);
	const value = useMemo(
		() => ({ activeServices, bgToolIds }),
		[activeServices, bgToolIds],
	);

	return (
		<ActiveServicesContext.Provider value={value}>
			{children}
		</ActiveServicesContext.Provider>
	);
};

export const useActiveServices = () => {
	const context = useContext(ActiveServicesContext);
	if (!context) throw new Error('useActiveServices must be used within ActiveServicesProvider');
	return context;
};
