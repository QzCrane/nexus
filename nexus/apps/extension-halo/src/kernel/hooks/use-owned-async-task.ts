import { useCallback, useEffect, useRef, useState } from 'react';
import {
	OwnedAsyncTask,
	type OwnedTaskExecution,
	type OwnedTaskOutcome,
	type OwnedTaskSnapshot,
} from '../utils/owned-async-task';

export function useOwnedAsyncTask(): OwnedTaskSnapshot & {
	run: <T>(start: () => Promise<T> | OwnedTaskExecution<T>, deadlineMs?: number) => Promise<OwnedTaskOutcome<T>>;
	cancel: () => void;
} {
	const [snapshot, setSnapshot] = useState<OwnedTaskSnapshot>({ phase: 'idle', error: null });
	const mounted = useRef(true);
	const owner = useRef<OwnedAsyncTask | null>(null);
	if (!owner.current) {
		owner.current = new OwnedAsyncTask((next) => {
			if (mounted.current) setSnapshot(next);
		});
	}
	useEffect(() => {
		mounted.current = true;
		if (owner.current?.isDisposed) {
			owner.current = new OwnedAsyncTask((next) => {
				if (mounted.current) setSnapshot(next);
			});
		}
		return () => {
			mounted.current = false;
			owner.current?.dispose();
		};
	}, []);
	const run = useCallback(<T,>(start: () => Promise<T> | OwnedTaskExecution<T>, deadlineMs?: number) => (
		owner.current?.run(start, deadlineMs) ?? Promise.resolve({ kind: 'cancelled', reason: 'disposed' } as const)
	), []);
	const cancel = useCallback(() => owner.current?.cancel(), []);
	return { ...snapshot, run, cancel };
}
