import { useMemo, useSyncExternalStore } from 'react';
import type { UserScript } from '../types';
import {
	getUserScriptsStorageSnapshot,
	subscribeUserScriptsStorage,
} from '../storage-authority';

export function useUserScriptsStorageSnapshot() {
	return useSyncExternalStore(
		subscribeUserScriptsStorage,
		getUserScriptsStorageSnapshot,
		getUserScriptsStorageSnapshot,
	);
}

function materializeScript(script: Readonly<UserScript>): UserScript {
	return {
		...script,
		matches: [...script.matches],
		...(script.excludeMatches ? { excludeMatches: [...script.excludeMatches] } : {}),
	};
}

export function useLauncherUserScripts(): { scripts: UserScript[]; loading: boolean } {
	const snapshot = useUserScriptsStorageSnapshot();
	const scripts = useMemo(
		() => snapshot.scripts.map(materializeScript),
		[snapshot.scripts],
	);
	return { scripts, loading: !snapshot.ready };
}

export const userScriptsSnapshotHookTestApi = { materializeScript };
