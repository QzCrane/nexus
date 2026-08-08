// goal: Hook to access user scripts from the shared storage authority
// eff: Multiple consumers reuse one Chrome read/listener lifecycle

import { useMemo, useSyncExternalStore } from 'react';
import {
	getUserScriptsStorageSnapshot,
	subscribeUserScriptsStorage,
} from '../stores/user-scripts-storage';

export function useUserScripts() {
	const snapshot = useSyncExternalStore(
		subscribeUserScriptsStorage,
		getUserScriptsStorageSnapshot,
		getUserScriptsStorageSnapshot,
	);
	// Preserve the historical mutable-array hook surface without manufacturing a
	// new identity on unrelated renders. The shared authority itself stays readonly.
	const scripts = useMemo(() => [...snapshot.scripts], [snapshot.scripts]);
	return { scripts, loading: !snapshot.ready };
}
