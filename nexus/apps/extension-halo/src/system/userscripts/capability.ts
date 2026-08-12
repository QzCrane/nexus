// goal: one runtime check for the optional Chrome User Scripts capability
// inv: permission/toggle availability is proven by a real API method, never namespace presence alone

export async function isUserScriptsCapabilityAvailable(): Promise<boolean> {
	try {
		if (typeof chrome.userScripts === 'undefined') return false;
		// Chrome may leave the namespace present in a live context after the user
		// revokes access while calls reject. A method probe therefore owns the
		// authoritative runtime capability check across Chrome versions.
		await chrome.userScripts.getScripts();
		return true;
	} catch {
		return false;
	}
}
