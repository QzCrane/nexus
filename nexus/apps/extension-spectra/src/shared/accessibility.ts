// goal: gate interactive UI on the one statically declared accessibility stylesheet
// inv: HTML owns the physical asset; readiness has a deadline and no retired-page continuation

const POLICY_ID = 'spectra-accessibility-policy';
let readyPromise: Promise<void> | null = null;

export function installAccessibilityPolicy(): Promise<void> {
	if (readyPromise) return readyPromise;
	const link = document.getElementById(POLICY_ID);
	if (!(link instanceof HTMLLinkElement)) return Promise.reject(new Error('SPECTRA accessibility policy is not declared'));
	if (link.sheet) return Promise.resolve();
	const pending = new Promise<void>((resolve, reject) => {
		let settled = false;
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			link.removeEventListener('load', loaded);
			link.removeEventListener('error', failed);
			window.removeEventListener('pagehide', retired);
			if (error) reject(error); else resolve();
		};
		const loaded = () => finish();
		const failed = () => finish(new Error('SPECTRA accessibility policy failed to load'));
		const retired = () => finish(new Error('SPECTRA accessibility page retired'));
		const timer = setTimeout(() => finish(new Error('SPECTRA accessibility policy timed out')), 5_000);
		link.addEventListener('load', loaded, { once: true });
		link.addEventListener('error', failed, { once: true });
		window.addEventListener('pagehide', retired, { once: true });
	});
	readyPromise = pending;
	void pending.catch(() => { if (readyPromise === pending) readyPromise = null; });
	return pending;
}
