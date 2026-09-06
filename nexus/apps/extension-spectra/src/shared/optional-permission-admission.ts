// goal: one user-gesture owner for SPECTRA optional Chrome permissions
// inv: runtime consumers never call request(); UI admission is explicit and request() is the first async capability boundary

export type SpectraOptionalPermission = 'downloads' | 'userScripts';

export async function hasOptionalPermission(permission: SpectraOptionalPermission): Promise<boolean> {
	return chrome.permissions.contains({ permissions: [permission] });
}

export function requestOptionalPermission(permission: SpectraOptionalPermission): Promise<boolean> {
	// Do not await contains() first: Chrome permission admission is user-gesture
	// sensitive, so the request itself must remain the first async Chrome call
	// made by the click/save handler. request() is idempotent when already granted.
	return chrome.permissions.request({ permissions: [permission] });
}
