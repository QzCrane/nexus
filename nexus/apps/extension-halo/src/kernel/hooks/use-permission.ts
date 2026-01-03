import { useState, useEffect, useCallback } from 'react';

export function usePermission(permission: string) {
	const [hasPermission, setHasPermission] = useState<boolean | null>(null);

	const check = useCallback(async () => {
		try {
			const result = await chrome.permissions.contains({ permissions: [permission] });
			setHasPermission(result);
		} catch (err) {
			console.warn('Permission check failed:', err);
			setHasPermission(false);
		}
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
