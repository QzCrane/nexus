
import { TimelineBase } from './core/TimelineBase';
import { waitForElement, normalizeText, getScrollableAncestor } from './core/utils';

class GeminiTimeline extends TimelineBase {
	// Selectors (from original)
	private static SEL_USER_BUBBLE = [
		'.user-query-bubble-with-background',
		'.user-query-container.right-align-content',
		'user-query'
	].join(',');

	protected conversationContainer: HTMLElement | null = null;
	protected scrollContainer: HTMLElement | null = null;

	protected extractId(el: HTMLElement): string | null {
		return el.getAttribute('data-turn-id') || null;
	}

	protected extractSummary(el: HTMLElement): string {
		// Gemini complex summary extraction (from original)
		try {
			const line = el.querySelector('.query-text .query-text-line');
			if (line && line.textContent) return normalizeText(line.textContent);
		} catch { }
		return normalizeText(el.textContent || '');
	}

	protected getStarStorageKey(): string | null {
		if (!this.conversationId) return null;
		return `geminiTimelineStars:${this.conversationId}`;
	}

	protected collectUserNodes(): HTMLElement[] {
		const root = this.conversationContainer || document;

		// Priority 1: bubble itself (from original logic)
		try {
			const bubbles = Array.from(root.querySelectorAll('.user-query-bubble-with-background')) as HTMLElement[];
			const filtered = bubbles.filter(n => this.hasUserText(n));
			if (filtered.length) return filtered;
		} catch { }

		// Priority 2: right-aligned user container
		try {
			const rights = Array.from(root.querySelectorAll('.user-query-container.right-align-content')) as HTMLElement[];
			const filtered = rights.filter(n => this.hasUserText(n));
			if (filtered.length) return filtered;
		} catch { }

		// Priority 3: custom element
		try {
			const tags = Array.from(root.querySelectorAll('user-query')) as HTMLElement[];
			return tags.filter(n => this.hasUserText(n));
		} catch { return []; }
	}

	private hasUserText(el: HTMLElement): boolean {
		try {
			const line = el.querySelector('.query-text .query-text-line');
			if (line && typeof line.textContent === 'string' && line.textContent.trim().length > 0) return true;
		} catch { }
		try {
			const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
			return t.length > 0;
		} catch { return false; }
	}

	protected async mount(): Promise<void> {
		// Wait for first user bubble
		const first = await waitForElement(GeminiTimeline.SEL_USER_BUBBLE.split(',')[0] || '.user-query-bubble-with-background');
		if (!first) return;

		// Find conversation root (lowest common ancestor of all bubbles)
		this.conversationContainer = this.findConversationRootFromFirst(first);
		this.scrollContainer = getScrollableAncestor(
			this.conversationContainer,
			'#chat-history.chat-history-scroll-container',
			'[data-test-id="chat-history-container"]'
		) || document.body;

		// Extract conversation ID
		const segs = location.pathname.split('/');
		if (segs.includes('app')) {
			const idx = segs.indexOf('app');
			const id = segs[idx + 1];
			if (id) this.conversationId = id;
		}
	}

	private findConversationRootFromFirst(firstMsg: HTMLElement): HTMLElement {
		try {
			const all = Array.from(document.querySelectorAll(GeminiTimeline.SEL_USER_BUBBLE));
			let node = firstMsg.parentElement;
			while (node && node !== document.body) {
				let allInside = true;
				for (let i = 0; i < all.length; i++) {
					const el = all[i];
					if (el && !node.contains(el)) { allInside = false; break; }
				}
				if (allInside) return node;
				// @ts-ignore
				node = node.parentElement;
			}
		} catch { }
		return firstMsg.parentElement || document.body;
	}

	protected startObservers() {
		if (this.conversationContainer) {
			const obs = new MutationObserver(() => {
				this.rebuildMarkers();
			});
			obs.observe(this.conversationContainer, { childList: true, subtree: true });
			this.observers.push(obs);
		}

		const ro = new ResizeObserver(() => {
			this.updateTimelineGeometry();
			this.updateVirtualRangeAndRender();
			this.syncTimelineTrackToMain();
		});
		if (this.timelineBar) ro.observe(this.timelineBar);
		if (this.scrollContainer) ro.observe(this.scrollContainer);
		this.observers.push(ro);
	}
}

// === Entry Point ===
let instance: GeminiTimeline | null = null;
let currentUrl = location.href;

function init() {
	if (instance) instance.destroy();
	instance = new GeminiTimeline();
	// IMPORTANT: init() FIRST to create UI, THEN set manager to trigger config sync
	instance.init();
	// @ts-ignore
	window.haloTimelineManager = instance;
	window.dispatchEvent(new CustomEvent('halo-timeline-ready'));
}

function checkRoute() {
	if (location.href !== currentUrl) {
		currentUrl = location.href;
		const segs = location.pathname.split('/').filter(Boolean);
		const iApp = segs.indexOf('app');
		// @ts-ignore
		const isConv = iApp !== -1 && segs[iApp + 1] && /^[A-Za-z0-9_-]+$/.test(segs[iApp + 1]);

		if (isConv) {
			setTimeout(init, 500);
		} else {
			if (instance) { instance.destroy(); instance = null; }
		}
	}
}

setInterval(checkRoute, 1000);
// Initial check
if (location.pathname.includes('/app/')) init();
