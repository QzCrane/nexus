import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from '../../../i18n';
import type { UserScript } from '../types';
import {
	getUserScriptsState,
	deleteUserScript,
	toggleUserScript,
	toggleGlobalEnabled,
	reorderScript,
} from '../core';
import { injectScriptToCurrentTab } from '../engine';
import { useToast } from '../../../components/ToastProvider';

export function useUserScripts() {
	const { t } = useTranslation();
	const { showToast } = useToast();
	const [scripts, setScripts] = useState<UserScript[]>([]);
	const [globalEnabled, setGlobalEnabled] = useState(true);
	const [currentUrl, setCurrentUrl] = useState('');
	const [hasPermission, setHasPermission] = useState(false);

	const loadScripts = useCallback(async () => {
		const state = await getUserScriptsState();
		setScripts(state.scripts);
		setGlobalEnabled(state.globalEnabled);
	}, []);

	useEffect(() => { loadScripts(); }, [loadScripts]);

	// Permissions and URL tracking
	useEffect(() => {
		const checkStatus = async () => {
			const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
			if (tab?.url) setCurrentUrl(tab.url);

			const hasHosts = await chrome.permissions.contains({ origins: ['*://*/*'] });
			const hasUserScripts = await chrome.permissions.contains({ permissions: ['userScripts'] });
			const hasWebNav = await chrome.permissions.contains({ permissions: ['webNavigation'] });
			setHasPermission(hasUserScripts || (hasWebNav && hasHosts));
		};
		checkStatus();

		const onActive = () => checkStatus();
		const onUpdate = (_: number, change: any, tab: chrome.tabs.Tab) => {
			if (tab.active && change.url) checkStatus();
		};
		// @ts-ignore
		const onPermChange = () => checkStatus();
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
		try { granted = await chrome.permissions.request({ permissions: ['userScripts'], origins: ['*://*/*'] }); } catch { }
		if (!granted) granted = await chrome.permissions.request({ permissions: ['webNavigation'], origins: ['*://*/*'] });

		if (granted) {
			setHasPermission(true);
			showToast(`✅ ${t('userscripts.permsGranted', { defaultValue: 'Permissions granted' })}`);
			chrome.runtime.sendMessage({ type: 'HALO_USERSCRIPTS_SYNC' }).catch(() => { });
		}
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

	return {
		scripts,
		globalEnabled,
		currentUrl,
		hasPermission,
		loadScripts,
		handleRequestPermission,
		handleGlobalToggle,
		handleToggle,
		handleDelete,
		handleTest,
		handleMove
	};
}
