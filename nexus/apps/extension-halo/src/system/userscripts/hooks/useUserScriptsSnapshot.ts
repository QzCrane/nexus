import { useMemo, useSyncExternalStore } from 'react';
import type { UserScript } from '../types';
import {
	getUserScriptsStorageSnapshot,
	subscribeUserScriptsStorage,
	type UserScriptsSnapshotScript,
} from '../storage-authority';

export function useUserScriptsStorageSnapshot() {
	return useSyncExternalStore(
		subscribeUserScriptsStorage,
		getUserScriptsStorageSnapshot,
		getUserScriptsStorageSnapshot,
	);
}

function materializeScript(script: UserScriptsSnapshotScript): UserScript {
	const { matches, excludeMatches, ...fields } = script;
	return {
		...fields,
		matches: [...matches],
		...(excludeMatches ? { excludeMatches: [...excludeMatches] } : {}),
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
