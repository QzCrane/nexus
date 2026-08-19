// goal: one extension-page accessibility owner for keyboard focus and reduced motion
// inv: Popup and Options load the same policy asset before interactive UI initialization

const POLICY_ID = 'spectra-accessibility-policy';

let readyPromise: Promise<void> | null = null;

export function installAccessibilityPolicy(): Promise<void> {
	if (readyPromise) return readyPromise;
	const existing = document.getElementById(POLICY_ID) as HTMLLinkElement | null;
	if (existing) {
		readyPromise = existing.sheet
			? Promise.resolve()
			: new Promise((resolveReady, rejectReady) => {
				existing.addEventListener('load', () => resolveReady(), { once: true });
				existing.addEventListener('error', () => rejectReady(new Error('SPECTRA accessibility policy failed to load')), { once: true });
			});
		return readyPromise;
	}

	const link = document.createElement('link');
	link.id = POLICY_ID;
	link.rel = 'stylesheet';
	link.href = chrome.runtime.getURL('accessibility.css');
	readyPromise = new Promise((resolveReady, rejectReady) => {
		link.addEventListener('load', () => resolveReady(), { once: true });
		link.addEventListener('error', () => rejectReady(new Error('SPECTRA accessibility policy failed to load')), { once: true });
	});
	document.head.append(link);
	return readyPromise;
}
