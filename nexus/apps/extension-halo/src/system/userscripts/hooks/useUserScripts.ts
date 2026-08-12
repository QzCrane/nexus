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

function isSuccessfulRegistrySyncResponse(value: unknown): value is { success: true } {
	return typeof value === 'object'
		&& value !== null
		&& 'success' in value
		&& value.success === true;
}

function registrySyncFailureMessage(value: unknown): string {
	if (typeof value === 'object'
		&& value !== null
		&& 'error' in value
		&& typeof value.error === 'string'
		&& value.error.length > 0) return value.error;
	return 'Background UserScripts registry synchronization failed';
}

export function useUserScripts() {
	const { t } = useTranslation();
	const { showToast } = useToast();
	const [scripts, setScripts] = useState<UserScript[]>([]);
	const [globalEnabled, setGlobalEnabled] = useState(true);
	const [currentUrl, setCurrentUrl] = useState('');
	const [hasPermission, setHasPermission] = useState(false);
	const runtimeAccessRef = useRef(false);
	const statusRevisionRef = useRef(0);
	const readinessSyncRef = useRef<Promise<void> | null>(null);

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

	const ensureBackgroundRegistryReady = useCallback(async (): Promise<void> => {
		if (!readinessSyncRef.current) {
			readinessSyncRef.current = (async () => {
				const response: unknown = await chrome.runtime.sendMessage({ type: 'HALO_USERSCRIPTS_SYNC' });
				if (!isSuccessfulRegistrySyncResponse(response)) {
					throw new Error(registrySyncFailureMessage(response));
				}
			})().finally(() => { readinessSyncRef.current = null; });
		}
		await readinessSyncRef.current;
	}, []);

	const refreshPermissionStatus = useCallback(async (): Promise<boolean> => {
		const revision = ++statusRevisionRef.current;
		const [tab, hasHosts, hasUserScripts] = await Promise.all([
			chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => tabs[0]),
			chrome.permissions.contains({ origins: ['*://*/*'] }),
			chrome.permissions.contains({ permissions: ['userScripts'] }),
		]);
		if (revision !== statusRevisionRef.current) return runtimeAccessRef.current;
		if (tab?.url) setCurrentUrl(tab.url);

		const platformAvailable = hasHosts && hasUserScripts
			? await isUserScriptsCapabilityAvailable()
			: false;
		if (revision !== statusRevisionRef.current) return runtimeAccessRef.current;
		if (!platformAvailable) {
			runtimeAccessRef.current = false;
			setHasPermission(false);
			return false;
		}

		if (!runtimeAccessRef.current) {
			try {
				await ensureBackgroundRegistryReady();
			} catch (error) {
				if (revision === statusRevisionRef.current) {
					runtimeAccessRef.current = false;
					setHasPermission(false);
				}
				throw error;
			}
		}
		if (revision !== statusRevisionRef.current) return runtimeAccessRef.current;
		runtimeAccessRef.current = true;
		setHasPermission(true);
		return true;
	}, [ensureBackgroundRegistryReady]);

	// Permissions, Chrome's per-extension Allow User Scripts toggle, Background
	// registry convergence, and URL tracking form one readiness projection.
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
		let available = false;
		try {
			available = await refreshPermissionStatus();
		} catch (error: unknown) {
			console.error('[HALO:UserScripts] Registry readiness failed', error);
			showToast(`❌ ${t('userscripts.registrySyncFailed', {
				defaultValue: 'User Scripts access is enabled, but Background registry synchronization failed. Try again.',
			})}`);
			return;
		}
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
