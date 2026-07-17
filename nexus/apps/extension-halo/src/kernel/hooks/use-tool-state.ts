import { useState, useEffect, useCallback, useRef } from 'react';
import { ToolId } from '../core/types';
import { safeStorageGet, safeStorageSet } from '../core/safe-storage';

export interface UseToolStateOptions {
	/** Storage area: 'local' (default) or 'sync' */
	area?: 'local' | 'sync';
	/** Debounce delay for writes (default: 300ms) */
	debounceMs?: number;
	/** Custom storage key override */
	storageKey?: string;
}

/**
 * goal: Standardized tool state persistence with performance optimization
 * features: 
 *   1. Auto-loading from chrome.storage
 *   2. Debounced writes to prevent storage bottlenecks
 *   3. Global sync across multiple sidepanels
 *   4. Configurable storage area (sync/local)
 */
export function useToolState<T>(
	toolId: ToolId | string,
	initialState: T | (() => T),
	options: UseToolStateOptions = {}
) {
	const { area = 'local', debounceMs = 300, storageKey: customKey } = options;

	const getInitialValue = useCallback(() => {
		return typeof initialState === 'function' ? (initialState as () => T)() : initialState;
	}, [initialState]);

	const [state, setState] = useState<T>(getInitialValue);
	const [isReady, setIsReady] = useState(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const storageKey = customKey ?? `halo_tool_state_${toolId}`;

	// rule: hold the latest initial value in a ref so the load effect doesn't re-run when
	// callers pass a new object literal each render — the previous version put getInitialValue
	// in the load effect's deps, causing the effect to fire every render, async-load the
	// stale storage value, and clobber in-flight user edits via setState before the debounced
	// save fired.
	const initialValueRef = useRef(getInitialValue);
	useEffect(() => { initialValueRef.current = getInitialValue; }, [getInitialValue]);

	// rule: track whether a debounced save is pending — the storage.onChanged listener
	// must skip overwrites while a save is in-flight, otherwise external co-author writes
	// (other sidepanels) are silently dropped.
	const savePendingRef = useRef(false);

	// Load initial state — rule: deps are only key/area, not getInitialValue
	useEffect(() => {
		let isMounted = true;
		const baseValue = initialValueRef.current();
		safeStorageGet([storageKey], { [storageKey]: baseValue }, { area }).then((res) => {
			if (isMounted) {
				const storedValue = res[storageKey] as T | undefined;
				setState(storedValue !== undefined ? storedValue : baseValue);
				setIsReady(true);
			}
		});
		return () => { isMounted = false; };
	}, [toolId, storageKey, area]);

	// Save state with debounce
	const saveState = useCallback((newState: T) => {
		if (timerRef.current) clearTimeout(timerRef.current);
		savePendingRef.current = true;

		timerRef.current = setTimeout(() => {
			savePendingRef.current = false;
			safeStorageSet({ [storageKey]: newState }, { area });
		}, debounceMs);
	}, [storageKey, debounceMs, area]);

	// Update helper
	const updateState = useCallback((action: React.SetStateAction<T>) => {
		setState((prev) => {
			const next = typeof action === 'function'
				? (action as (prev: T) => T)(prev)
				: action;
			saveState(next);
			return next;
		});
	}, [saveState]);


	// Listen for external changes (other sidepanels) — rule: skip overwrites while a
	// debounced save is pending so external co-author writes are not silently dropped.
	useEffect(() => {
		const handler = (changes: Record<string, chrome.storage.StorageChange>, changedArea: string) => {
			if (changedArea === area && changes[storageKey] && !savePendingRef.current) {
				setState(changes[storageKey].newValue as T);
			}
		};
		chrome.storage.onChanged.addListener(handler);
		return () => chrome.storage.onChanged.removeListener(handler);
	}, [storageKey, area]);

	return [state, updateState, isReady] as const;
}

