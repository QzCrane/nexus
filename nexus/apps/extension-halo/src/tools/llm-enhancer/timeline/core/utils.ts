
// DOM Utilities

export function waitForElement(selector: string, timeoutMs = 5000): Promise<HTMLElement | null> {
	return new Promise((resolve) => {
		const el = document.querySelector(selector) as HTMLElement;
		if (el) return resolve(el);
		const obs = new MutationObserver(() => {
			const n = document.querySelector(selector) as HTMLElement;
			if (n) {
				disconnect(obs);
				resolve(n);
			}
		});
		try { obs.observe(document.body, { childList: true, subtree: true }); } catch { }
		setTimeout(() => { disconnect(obs); resolve(null); }, timeoutMs);
	});
}

function disconnect(obs: MutationObserver) {
	try { obs.disconnect(); } catch { }
}

export function isElementScrollable(el: HTMLElement | null): boolean {
	if (!el) return false;
	try {
		const cs = getComputedStyle(el);
		const oy = (cs.overflowY || '').toLowerCase();
		const ok = oy === 'auto' || oy === 'scroll' || oy === 'overlay';
		if (!ok && el !== document.scrollingElement && el !== document.documentElement && el !== document.body) return false;
		if ((el.scrollHeight - el.clientHeight) > 4) return true;
		const prev = el.scrollTop;
		el.scrollTop = prev + 1;
		const changed = el.scrollTop !== prev;
		el.scrollTop = prev;
		return changed;
	} catch { return false; }
}

export function getScrollableAncestor(startEl: HTMLElement, primarySel?: string, altSel?: string): HTMLElement {
	// 1. Site-provided containers
	if (primarySel) {
		try {
			const p = document.querySelector(primarySel) as HTMLElement;
			if (p && (p.contains(startEl) || startEl.contains(p)) && isElementScrollable(p)) return p;
		} catch { }
	}
	if (altSel) {
		try {
			const a = document.querySelector(altSel) as HTMLElement;
			if (a && (a.contains(startEl) || startEl.contains(a)) && isElementScrollable(a)) return a;
		} catch { }
	}
	// 2. Climb ancestors
	let el: HTMLElement | null = startEl;
	while (el && el !== document.body) {
		if (isElementScrollable(el)) return el;
		el = el.parentElement;
	}
	// 3. Document fallback
	const docScroll = document.scrollingElement || document.documentElement || document.body;
	return isElementScrollable(docScroll as HTMLElement) ? (docScroll as HTMLElement) : (document.documentElement || document.body);
}

export function clamp01(x: number): number {
	return Math.max(0, Math.min(1, x));
}

export function getCSSVarNumber(el: HTMLElement, name: string, fallback: number): number {
	try {
		const v = getComputedStyle(el).getPropertyValue(name).trim();
		const n = parseFloat(v);
		return Number.isFinite(n) ? n : fallback;
	} catch { return fallback; }
}

export function buildStableHash(text: string): string {
	try {
		let h = 2166136261 >>> 0;
		for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
		return (h >>> 0).toString(36);
	} catch { return Math.random().toString(36).slice(2, 8); }
}

export function normalizeText(text: string): string {
	try {
		let s = String(text || '').replace(/\s+/g, ' ').trim();
		s = s.replace(/^\s*(you\s*said\s*[:：]?\s*)/i, '');
		s = s.replace(/^\s*((你说|您说|你說|您說)\s*[:：]?\s*)/, '');
		return s;
	} catch { return ''; }
}
