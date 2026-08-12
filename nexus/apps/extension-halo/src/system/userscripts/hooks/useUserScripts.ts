import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from '../../../i18n';
import type { UserScript, UserScriptState } from '../types';
import {
	getUserScriptsState,
	deleteUserScript,
	toggleUserScript,
	toggleGlobalEnabled,
	reorderScript,
} from '../core';
import { injectScriptToCurrentTab } from '../engine';
import { useToast } from '../../../components/ToastProvider';
import { isUserScriptsCapabilityAvailable } from '../capability';
import {
	createUserScriptsStateLoader,
	type UserScriptsStateLoader,
} from './user-scripts-state-loader';

export function useUserScripts() {
	const { t } = useTranslation();
	const { showToast } = useToast();
	const [scripts, setScripts] = useState<UserScript[]>([]);
	const [globalEnabled, setGlobalEnabled] = useState(true);
	const [currentUrl, setCurrentUrl] = useState('');
	const [hasPermission, setHasPermission] = useState(false);
	const runtimeAccessRef = useRef(false);

	// Toolbar config
	const [toolbarConfig, setToolbarConfig] = useState<UserScriptState['toolbarConfig']>();

	const stateLoaderRef = useRef<UserScriptsStateLoader | null>(null);
	if (stateLoaderRef.current === null) {
		stateLoaderRef.current = createUserScriptsStateLoader(
			getUserScriptsState,
			(state) => {
				setScripts(state.scripts);
				setGlobalEnabled(state.globalEnabled);
				setToolbarConfig(state.toolbarConfig || {
					order: ['add', 'export', 'import'],
					hideOnOverflow: false,
				});
			},
			(error) => {
				console.error('[HALO:UserScripts] Failed to load scripts', error);
			},
		);
	}
	const stateLoader = stateLoaderRef.current;
	const loadScripts = useCallback(() => stateLoader.load(), [stateLoader]);

	useEffect(() => {
		stateLoader.activate();
		void loadScripts();
		return () => stateLoader.dispose();
	}, [loadScripts, stateLoader]);

	const refreshPermissionStatus = useCallback(async (): Promise<boolean> => {
		const [tab, hasHosts, hasUserScripts] = await Promise.all([
			chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => tabs[0]),
			chrome.permissions.contains({ origins: ['*://*/*'] }),
			chrome.permissions.contains({ permissions: ['userScripts'] }),
		]);
		if (tab?.url) setCurrentUrl(tab.url);
		const available = hasHosts && hasUserScripts
			? await isUserScriptsCapabilityAvailable()
			: false;
		const becameAvailable = available && !runtimeAccessRef.current;
		runtimeAccessRef.current = available;
		setHasPermission(available);
		if (becameAvailable) {
			void chrome.runtime.sendMessage({ type: 'HALO_USERSCRIPTS_SYNC' }).catch((error: unknown) => {
				console.warn('[HALO:UserScripts] Background sync notification failed', error);
			});
		}
		return available;
	}, []);

	// Permissions, Chrome's per-extension Allow User Scripts toggle, and URL
	// tracking all participate in the same runtime readiness projection.
	useEffect(() => {
		const refreshStatus = () => {
			void refreshPermissionStatus().catch((error: unknown) => {
				console.error('[HALO:UserScripts] Failed to refresh permission status', error);
			});
		};
		refreshStatus();

		const onActive = () => refreshStatus();
		const onUpdate: Parameters<typeof chrome.tabs.onUpdated.addListener>[0] = (
			_tabId,
			change,
			tab,
		) => {
			if (tab.active && change.url) refreshStatus();
		};
		const onPermChange = () => refreshStatus();
		if (chrome.permissions.onAdded) chrome.permissions.onAdded.addListener(onPermChange);
		if (chrome.permissions.onRemoved) chrome.permissions.onRemoved.addListener(onPermChange);
		chrome.tabs.onActivated.addListener(onActive);
		chrome.tabs.onUpdated.addListener(onUpdate);
		return () => {
			chrome.tabs.onActivated.removeListener(onActive);
			chrome.tabs.onUpdated.removeListener(onUpdate);
			if (chrome.permissions.onAdded) chrome.permissions.onAdded.removeListener(onPermChange);
			if (chrome.permissions.onRemoved) chrome.permissions.onRemoved.removeListener(onPermChange);
		};
	}, [refreshPermissionStatus]);

	const handleRequestPermission = async () => {
		let granted = false;
		try {
			granted = await chrome.permissions.request({
				permissions: ['userScripts'],
				origins: ['*://*/*'],
			});
		} catch (error: unknown) {
			console.error('[HALO:UserScripts] Permission request failed', error);
			showToast(`❌ ${t('userscripts.permsFailed', {
				defaultValue: 'Permission request failed',
			})}`);
			return;
		}

		if (!granted) return;
		const available = await refreshPermissionStatus();
		if (available) {
			showToast(`✅ ${t('userscripts.permsGranted', { defaultValue: 'Permissions granted' })}`);
			return;
		}
		showToast(`⚠️ ${t('userscripts.allowUserScriptsRequired', {
			defaultValue: 'Enable “Allow User Scripts” in this extension’s details, then return to HALO.',
		})}`);
	};

	const handleGlobalToggle = async () => {
		const newState = await toggleGlobalEnabled();
		setGlobalEnabled(newState);
		showToast(newState
			? `✅ ${t('userscripts.scriptsEnabled')}`
			: `⏸️ ${t('userscripts.scriptsDisabled')}`);
	};

	const handleToggle = async (id: string) => {
		await toggleUserScript(id);
		await loadScripts();
	};

	const handleDelete = async (id: string) => {
		if (!confirm(t('userscripts.deleteConfirm'))) return;
		await deleteUserScript(id);
		await loadScripts();
		showToast(`🗑️ ${t('userscripts.scriptDeleted')}`);
	};

	const handleTest = async (script: UserScript) => {
		const success = await injectScriptToCurrentTab(script);
		showToast(success
			? `✅ ${t('userscripts.executed', { name: script.name })}`
			: `❌ ${t('userscripts.injectionFailed')}`);
	};

	const handleMove = async (id: string, dir: 'up' | 'down') => {
		await reorderScript(id, dir);
		await loadScripts();
	};

	const handleToolbarConfig = async (config: UserScriptState['toolbarConfig']) => {
		await import('../operations').then(ops => ops.saveToolbarConfig(config));
		await loadScripts();
	};

	return {
		scripts,
		globalEnabled,
		currentUrl,
		hasPermission,
		toolbarConfig,
		loadScripts,
		handleRequestPermission,
		handleGlobalToggle,
		handleToggle,
		handleDelete,
		handleTest,
		handleMove,
		handleToolbarConfig
	};
}
