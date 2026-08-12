import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { isUserScriptsCapabilityAvailable } from '../capability';
import {
	refreshUserScriptsStorage,
	type UserScriptsSnapshotScript,
} from '../storage-authority';
import { useUserScriptsStorageSnapshot } from './useUserScriptsSnapshot';

type PermissionStatusResult = 'ready' | 'unavailable' | 'stale';

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

const DEFAULT_TOOLBAR_CONFIG: NonNullable<UserScriptState['toolbarConfig']> = {
	order: ['add', 'export', 'import'],
	hideOnOverflow: false,
};

function materializeScript(script: UserScriptsSnapshotScript): UserScript {
	return {
		...script,
		matches: [...script.matches],
		...(script.excludeMatches ? { excludeMatches: [...script.excludeMatches] } : {}),
	} as UserScript;
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
	const runtimeAccessRef = useRef(false);
	const statusRevisionRef = useRef(0);
	const readinessSyncRef = useRef<Promise<void> | null>(null);

	// Explicit external refreshes remain available, but owned writes publish via
	// the shared storage event and never issue a duplicate immediate read.
	const loadScripts = useCallback(async () => {
		await refreshUserScriptsStorage();
	}, []);

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

	const refreshPermissionStatus = useCallback(async (): Promise<PermissionStatusResult> => {
		const revision = ++statusRevisionRef.current;
		const [tab, hasHosts, hasUserScripts] = await Promise.all([
			chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => tabs[0]),
			chrome.permissions.contains({ origins: ['*://*/*'] }),
			chrome.permissions.contains({ permissions: ['userScripts'] }),
		]);
		if (revision !== statusRevisionRef.current) return 'stale';
		if (tab?.url) setCurrentUrl(tab.url);

		const platformAvailable = hasHosts && hasUserScripts
			? await isUserScriptsCapabilityAvailable()
			: false;
		if (revision !== statusRevisionRef.current) return 'stale';
		if (!platformAvailable) {
			runtimeAccessRef.current = false;
			setHasPermission(false);
			return 'unavailable';
		}

		try {
			// Always cross the idempotent Background receipt barrier. A previously
			// ready panel must not keep advertising readiness after script authority
			// changes have dirtied or blocked browser registration state.
			await ensureBackgroundRegistryReady();
		} catch (error) {
			if (revision !== statusRevisionRef.current) return 'stale';
			runtimeAccessRef.current = false;
			setHasPermission(false);
			throw error;
		}
		if (revision !== statusRevisionRef.current) return 'stale';
		runtimeAccessRef.current = true;
		setHasPermission(true);
		return 'ready';
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

	// A committed canonical snapshot represents a potentially new registry
	// generation. Revalidate even if the previous panel state was already ready;
	// the Background barrier is a no-op when the receipt is still satisfied.
	useEffect(() => {
		if (!snapshot.ready) return;
		void refreshPermissionStatus().catch((error: unknown) => {
			console.error('[HALO:UserScripts] Failed to revalidate registry authority', error);
		});
	}, [snapshot, refreshPermissionStatus]);

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
		let status: PermissionStatusResult = 'stale';
		try {
			// Permission events can start a newer refresh while this imperative call
			// is in flight. Retry retired reads instead of presenting their previous
			// readiness value as the final permission result.
			for (let attempt = 0; attempt < 3 && status === 'stale'; attempt += 1) {
				status = await refreshPermissionStatus();
			}
		} catch (error: unknown) {
			console.error('[HALO:UserScripts] Registry readiness failed', error);
			showToast(`❌ ${t('userscripts.registrySyncFailed', {
				defaultValue: 'User Scripts access is enabled, but Background registry synchronization failed. Try again.',
			})}`);
			return;
		}
		if (status === 'stale') return;
		if (status === 'ready') {
			showToast(`✅ ${t('userscripts.permsGranted', { defaultValue: 'Permissions granted' })}`);
			return;
		}
		showToast(`⚠️ ${t('userscripts.allowUserScriptsRequired', {
			defaultValue: 'Enable “Allow User Scripts” in this extension’s details, then return to HALO.',
		})}`);
	};

	const handleGlobalToggle = async () => {
		const newState = await toggleGlobalEnabled();
		showToast(newState
			? `✅ ${t('userscripts.scriptsEnabled')}`
			: `⏸️ ${t('userscripts.scriptsDisabled')}`);
	};

	const handleToggle = async (id: string) => {
		await toggleUserScript(id);
	};

	const handleDelete = async (id: string) => {
		if (!confirm(t('userscripts.deleteConfirm'))) return;
		await deleteUserScript(id);
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
	};

	const handleToolbarConfig = async (config: UserScriptState['toolbarConfig']) => {
		await import('../operations').then((operations) => operations.saveToolbarConfig(config));
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
		handleToolbarConfig,
	};
}
