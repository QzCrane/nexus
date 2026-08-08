// goal: Launcher projection for custom user-authored scripts
// inv: the optional UserScripts module owns only custom records, never packaged/SaaT runtimes

import { useEffect, useMemo, useState } from 'react';
import type { UserScript } from '../../system/userscripts/types';
import { useModuleManager } from './use-module-manager';

const USERSCRIPTS_STORAGE_KEY = 'halo_userscripts';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCustomScriptRecord(value: unknown): value is UserScript {
	return isRecord(value)
		&& typeof value.id === 'string'
		&& typeof value.enabled === 'boolean'
		&& value.saatToolId === undefined
		&& value.managedBy === undefined;
}

function readCustomScripts(value: unknown): UserScript[] {
	if (!isRecord(value) || !Array.isArray(value.scripts)) return [];
	return value.scripts.filter(isCustomScriptRecord);
}

export function useUserScripts() {
	const { installedModules, loading: modulesLoading } = useModuleManager();
	const enabled = useMemo(
		() => !modulesLoading && installedModules.some((module) => module.id === 'userscripts'),
		[modulesLoading, installedModules],
	);
	const [scripts, setScripts] = useState<UserScript[]>([]);
	const [storageLoading, setStorageLoading] = useState(false);

	useEffect(() => {
		if (!enabled) {
			setScripts([]);
			setStorageLoading(false);
			return;
		}
		let disposed = false;
		let eventRevision = 0;
		setStorageLoading(true);

		const listener = (
			changes: Record<string, chrome.storage.StorageChange>,
			areaName: string,
		) => {
			if (disposed || areaName !== 'local') return;
			const change = changes[USERSCRIPTS_STORAGE_KEY];
			if (!change) return;
			eventRevision += 1;
			setScripts(readCustomScripts(change.newValue));
			setStorageLoading(false);
		};
		chrome.storage.onChanged.addListener(listener);

		const revisionBeforeRead = eventRevision;
		void chrome.storage.local.get(USERSCRIPTS_STORAGE_KEY).then((result) => {
			if (disposed || eventRevision !== revisionBeforeRead) return;
			setScripts(readCustomScripts(result[USERSCRIPTS_STORAGE_KEY]));
			setStorageLoading(false);
		}).catch((error: unknown) => {
			if (disposed || eventRevision !== revisionBeforeRead) return;
			console.error('Failed to load custom user scripts:', error);
			setScripts([]);
			setStorageLoading(false);
		});

		return () => {
			disposed = true;
			chrome.storage.onChanged.removeListener(listener);
		};
	}, [enabled]);

	return { scripts, loading: modulesLoading || storageLoading };
}

export const userScriptsLauncherProjectionTestApi = { readCustomScripts };
