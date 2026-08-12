// goal: Launcher projection for custom user-authored scripts
// inv: persistence belongs to the shared UserScripts store while module health gates visibility

import { useMemo } from 'react';
import { useUserScriptsStorageSnapshot } from '../../system/userscripts/hooks/useUserScriptsSnapshot';
import type { UserScriptsSnapshotScript } from '../../system/userscripts/storage-authority';
import type { UserScript } from '../../system/userscripts/types';
import { useModuleManager } from './use-module-manager';

function materializeCustomScript(script: UserScriptsSnapshotScript): UserScript | null {
	if (script.saatToolId !== undefined || script.managedBy !== undefined) return null;
	const { matches, excludeMatches, ...fields } = script;
	return {
		...fields,
		matches: [...matches],
		...(excludeMatches ? { excludeMatches: [...excludeMatches] } : {}),
	};
}

export function useUserScripts(): { scripts: UserScript[]; loading: boolean } {
	const snapshot = useUserScriptsStorageSnapshot();
	const {
		installedModules,
		loading: modulesLoading,
		degraded,
	} = useModuleManager();
	const enabled = !modulesLoading
		&& !degraded
		&& installedModules.some((module) => module.id === 'userscripts');
	const scripts = useMemo(() => {
		if (!enabled || snapshot.failed) return [];
		return snapshot.scripts.flatMap((script) => {
			const materialized = materializeCustomScript(script);
			return materialized ? [materialized] : [];
		});
	}, [enabled, snapshot]);

	return { scripts, loading: modulesLoading || !snapshot.ready };
}

export const userScriptsLauncherProjectionTestApi = { materializeCustomScript };
