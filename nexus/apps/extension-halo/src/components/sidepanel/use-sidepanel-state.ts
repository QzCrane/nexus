// goal: SidePanel state management
// eff: Delegates open tools logic to useOpenTools hook

import { useState, useCallback, useEffect, useMemo } from 'react';
import type { HaloSettings, ToolId } from '../../kernel';
import { loadSettings, getThemeColors, applyTheme, TOOL_REGISTRY, saveSettings } from '../../kernel';
import { useModuleManager } from '../../kernel';
import { useOpenTools } from './hooks/use-open-tools';
import {
	activationToolId,
	isFreshSidepanelActivation,
	parseSidepanelActivationDelivery,
	parseSidepanelActivationEnvelope,
	SIDEPANEL_ACTIVATION_STORAGE_KEY,
	type SidepanelActivationEnvelope,
} from '../../kernel/core/sidepanel-activation';
import {
	acknowledgeSidepanelActivation,
	publishSidepanelActivation,
} from '../../kernel/core/sidepanel-activation-store';

export const useSidePanelState = () => {
	const {
		enabledModules,
		loading: modulesLoading,
	} = useModuleManager();
	const [settings, setSettings] = useState<HaloSettings | null>(null);
	const [settingsLoading, setSettingsLoading] = useState(true);
	const [openToolsLoading, setOpenToolsLoading] = useState(true);

	const {
		activeTool,
		openTools,
		handleToolSelect: baseToolSelect,
		handleCloseTool,
		handleBack,
		loadOpenTools,
	} = useOpenTools();

	const enabledToolIds = useMemo(
		() => new Set(enabledModules.map((module) => module.id)),
		[enabledModules],
	);
	const isEnabledSnapshot = useCallback(
		(id: string) => enabledToolIds.has(id),
		[enabledToolIds],
	);
	const visibleTools = useMemo(() => {
		if (modulesLoading) return TOOL_REGISTRY;
		return TOOL_REGISTRY
			.filter((tool) => enabledToolIds.has(tool.id))
			.map(tool => ({
				...tool,
				status: tool.status === 'available' ? 'ready' : tool.status
			}));
	}, [modulesLoading, enabledToolIds]);

	// Settings/theme are independent of module-manager hydration. Load them once
	// per SidePanel mount instead of repeating the storage read when
	// modulesLoading flips from true to false.
	useEffect(() => {
		let mounted = true;
		void loadSettings().then((loadedSettings) => {
			if (!mounted) return;
			setSettings(loadedSettings);
			applyTheme(getThemeColors(loadedSettings.theme, loadedSettings.accentColor));
		}).catch((error: unknown) => {
			console.error('[HALO:SidePanel] settings init failed', error);
		}).finally(() => {
			if (mounted) setSettingsLoading(false);
		});
		return () => { mounted = false; };
	}, []);

	// Open-tool restoration/reconciliation waits for the module authority and
	// reruns when its enabled snapshot changes. This retires a disabled
	// active/dock tool immediately instead of leaving stale UI until remount.
	useEffect(() => {
		if (modulesLoading) {
			setOpenToolsLoading(true);
			return;
		}
		let mounted = true;
		void loadOpenTools(isEnabledSnapshot).catch((error: unknown) => {
			console.error('[HALO:SidePanel] open-tools init failed', error);
		}).finally(() => {
			if (mounted) setOpenToolsLoading(false);
		});
		return () => { mounted = false; };
	}, [modulesLoading, isEnabledSnapshot, loadOpenTools]);

	const handleToolSelect = useCallback(async (toolId: ToolId) => {
		const tool = TOOL_REGISTRY.find(t => t.id === toolId);
		if (tool?.status === 'coming') return;
		if (!tool?.builtIn && !enabledToolIds.has(toolId)) return;
		await baseToolSelect(toolId);
	}, [baseToolSelect, enabledToolIds]);

	const consumeActivation = useCallback(async (envelope: SidepanelActivationEnvelope) => {
		if (!isFreshSidepanelActivation(envelope)) {
			await acknowledgeSidepanelActivation(envelope.id);
			return;
		}
		if (!publishSidepanelActivation(envelope)) return;
		await handleToolSelect(activationToolId(envelope.activation));
		if (envelope.activation.toolId === 'color-picker') {
			await acknowledgeSidepanelActivation(envelope.id);
		}
	}, [handleToolSelect]);

	useEffect(() => {
		let disposed = false;
		let storageEventObserved = false;
		const deliver = (envelope: SidepanelActivationEnvelope) => {
			if (disposed) return;
			void consumeActivation(envelope).catch((error: unknown) => {
				console.error('[HALO:SidePanel] Failed to activate tool', error);
			});
		};
		const runtimeListener = (message: unknown) => {
			const envelope = parseSidepanelActivationDelivery(message);
			if (envelope) deliver(envelope);
			return false;
		};
		const storageListener = (
			changes: Record<string, chrome.storage.StorageChange>,
			area: string,
		) => {
			if (area !== 'session' || !changes[SIDEPANEL_ACTIVATION_STORAGE_KEY]) return;
			storageEventObserved = true;
			const envelope = parseSidepanelActivationEnvelope(
				changes[SIDEPANEL_ACTIVATION_STORAGE_KEY].newValue,
			);
			if (envelope) deliver(envelope);
		};

		chrome.runtime.onMessage.addListener(runtimeListener);
		chrome.storage.onChanged.addListener(storageListener);
		void chrome.storage.session.get(SIDEPANEL_ACTIVATION_STORAGE_KEY).then((stored) => {
			if (disposed || storageEventObserved) return;
			const envelope = parseSidepanelActivationEnvelope(
				stored[SIDEPANEL_ACTIVATION_STORAGE_KEY],
			);
			if (envelope) deliver(envelope);
		}).catch((error: unknown) => {
			if (!disposed) console.error('[HALO:SidePanel] activation hydration failed', error);
		});

		return () => {
			disposed = true;
			chrome.runtime.onMessage.removeListener(runtimeListener);
			chrome.storage.onChanged.removeListener(storageListener);
		};
	}, [consumeActivation]);

	const handleSettingsChange = useCallback(async (updated: HaloSettings) => {
		setSettings(updated);
		applyTheme(getThemeColors(updated.theme, updated.accentColor));
		await saveSettings(updated);
	}, []);

	const handleTogglePin = useCallback((toolId: string) => {
		if (!settings) return;
		const pinned = [...(settings.pinnedTools || [])];
		const index = pinned.indexOf(toolId);
		if (index >= 0) {
			pinned.splice(index, 1);
		} else {
			pinned.push(toolId);
		}
		void handleSettingsChange({ ...settings, pinnedTools: pinned });
	}, [settings, handleSettingsChange]);

	const handleReorderTools = useCallback((category: string, toolIds: string[]) => {
		if (!settings) return;
		const newOrder = { ...(settings.toolOrder || {}), [category]: toolIds };
		void handleSettingsChange({ ...settings, toolOrder: newOrder });
	}, [settings, handleSettingsChange]);

	const handleReorderCategories = useCallback((categoryIds: string[]) => {
		if (!settings) return;
		void handleSettingsChange({ ...settings, categoryOrder: categoryIds });
	}, [settings, handleSettingsChange]);

	return {
		loading: settingsLoading || openToolsLoading,
		modulesLoading,
		activeTool,
		openTools,
		settings,
		visibleTools,
		handleToolSelect,
		handleCloseTool,
		handleBack,
		handleSettingsChange,
		handleTogglePin,
		handleReorderTools,
		handleReorderCategories
	};
};
