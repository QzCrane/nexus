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

	// Load initial state
	useEffect(() => {
		let isMounted = true;
		const baseValue = getInitialValue();
		safeStorageGet([storageKey], { [storageKey]: baseValue }, area).then((res) => {
			if (isMounted) {
				setState(res[storageKey] as T);
				setIsReady(true);
			}
		});
		return () => { isMounted = false; };
	}, [toolId, storageKey, area, getInitialValue]);

	// Save state with debounce
	const saveState = useCallback((newState: T) => {
		if (timerRef.current) clearTimeout(timerRef.current);

		timerRef.current = setTimeout(() => {
			safeStorageSet({ [storageKey]: newState }, area);
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


	// Listen for external changes (other sidepanels)
	useEffect(() => {
		const handler = (changes: Record<string, chrome.storage.StorageChange>, changedArea: string) => {
			if (changedArea === area && changes[storageKey]) {
				setState(changes[storageKey].newValue as T);
			}
		};
		chrome.storage.onChanged.addListener(handler);
		return () => chrome.storage.onChanged.removeListener(handler);
	}, [storageKey, area]);

	return [state, updateState, isReady] as const;
}

