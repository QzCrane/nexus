// goal: streamlined DOM selection helpers for extension popup/options contexts

export function $<T extends HTMLElement>(id: string): T | null {
	return document.getElementById(id) as T | null;
}

// $required: strictly selects element by ID, throws if missing to prevent silent UI failures
export function $required<T extends HTMLElement>(id: string): T {
	const el = document.getElementById(id) as T | null;
	if (!el) throw new Error(`Required element #${id} not found`);
	return el;
}

export function $$<T extends Element>(selector: string, parent: ParentNode = document): NodeListOf<T> {
	return parent.querySelectorAll<T>(selector);
}

export function getDomain(url: string): string {
	try {
		return new URL(url).hostname;
	} catch {
		return 'local';
	}
}

// Browser internal URLs where extensions are disabled
// Browser internal URLs where extensions are disabled
// eff: sorted by likelihood of occurrence for slight performance edge
const RESTRICTED = ['chrome', 'edge', 'about', 'moz-extension', 'file'];

// rule: identifies browser-internal or restricted URLs where extensions cannot operate
export function isRestrictedUrl(url: string | undefined): boolean {
	if (!url) return true;
	for (const p of RESTRICTED) {
		if (url.startsWith(p)) return true;
	}
	return false;
}
