import { useState, useEffect, useCallback } from 'react';

export function usePermission(permission: string) {
	const [hasPermission, setHasPermission] = useState<boolean | null>(null);

	const check = useCallback(() => {
		// Permissions check can be async
		chrome.permissions.contains({ permissions: [permission] }, (result) => {
			// Check for runtime error (if context invalid)
			if (chrome.runtime.lastError) {
				console.warn('Permission check failed:', chrome.runtime.lastError);
				// Fallback to false if check fails, safe default
				setHasPermission(false);
			} else {
				setHasPermission(result);
			}
		});
	}, [permission]);

	useEffect(() => {
		check();
	}, [check]);

	const request = useCallback(async () => {
		try {
			const granted = await chrome.permissions.request({ permissions: [permission] });
			setHasPermission(granted);
			return granted;
		} catch (err) {
			console.error('Permission request failed:', err);
			return false;
		}
	}, [permission]);

	return { hasPermission, request, recheck: check };
}
