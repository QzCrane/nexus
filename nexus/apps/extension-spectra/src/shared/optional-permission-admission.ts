// goal: one user-gesture owner for SPECTRA optional Chrome permissions
// inv: runtime consumers never call request(); UI admission is explicit and idempotent

export type SpectraOptionalPermission = 'downloads' | 'userScripts';

export async function hasOptionalPermission(permission: SpectraOptionalPermission): Promise<boolean> {
	return chrome.permissions.contains({ permissions: [permission] });
}

export async function requestOptionalPermission(permission: SpectraOptionalPermission): Promise<boolean> {
	if (await hasOptionalPermission(permission)) return true;
	return chrome.permissions.request({ permissions: [permission] });
}
