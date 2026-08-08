import { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from '../../../i18n';
import type { UserScript, UserScriptState } from '../types';
import {
	deleteUserScript,
	toggleUserScript,
	toggleGlobalEnabled,
	reorderScript,
} from '../core';
import { injectScriptToCurrentTab } from '../engine';
import { useToast } from '../../../components/ToastProvider';
import { refreshUserScriptsStorage } from '../storage-authority';
import { useUserScriptsStorageSnapshot } from './useUserScriptsSnapshot';

const DEFAULT_TOOLBAR_CONFIG: NonNullable<UserScriptState['toolbarConfig']> = {
	order: ['add', 'export', 'import'],
	hideOnOverflow: false,
};

function materializeScript(script: Readonly<UserScript>): UserScript {
	return {
		...script,
		matches: [...script.matches],
		...(script.excludeMatches ? { excludeMatches: [...script.excludeMatches] } : {}),
	};
}

export function useUserScripts() {
	const { t } = useTranslation();
	const { showToast } = useToast();
	const snapshot = useUserScriptsStorageSnapshot();
	const scripts = useMemo(
		() => snapshot.scripts.map(materializeScript),
		[snapshot.scripts],
	);
	const globalEnabled = snapshot.globalEnabled;
	const toolbarConfig = useMemo<UserScriptState['toolbarConfig']>(() => (
		snapshot.toolbarConfig
			? {
				order: [...snapshot.toolbarConfig.order],
				hideOnOverflow: snapshot.toolbarConfig.hideOnOverflow,
			}
			: { ...DEFAULT_TOOLBAR_CONFIG, order: [...DEFAULT_TOOLBAR_CONFIG.order] }
	), [snapshot.toolbarConfig]);
	const [currentUrl, setCurrentUrl] = useState('');
	const [hasPermission, setHasPermission] = useState(false);
	const loadScripts = useCallback(async () => {
		await refreshUserScriptsStorage();
	}, []);

	// Permissions and URL tracking are independent of script-storage authority.
	useEffect(() => {
		const checkStatus = async () => {
			const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
			if (tab?.url) setCurrentUrl(tab.url);

			const hasHosts = await chrome.permissions.contains({ origins: ['*://*/*'] });
			const hasUserScripts = await chrome.permissions.contains({ permissions: ['userScripts'] });
			setHasPermission(hasUserScripts && hasHosts);
		};
		const refreshStatus = () => {
			void checkStatus().catch((error: unknown) => {
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
	}, []);

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

		if (granted) {
			setHasPermission(true);
			showToast(`✅ ${t('userscripts.permsGranted', { defaultValue: 'Permissions granted' })}`);
			void chrome.runtime
				.sendMessage({ type: 'HALO_USERSCRIPTS_SYNC' })
				.catch((error: unknown) => {
					console.warn('[HALO:UserScripts] Background sync notification failed', error);
				});
		}
	};

	const handleGlobalToggle = async () => {
		const newState = await toggleGlobalEnabled();
		await loadScripts();
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
