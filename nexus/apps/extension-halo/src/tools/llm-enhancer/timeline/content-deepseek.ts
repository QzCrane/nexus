
import { TimelineBase } from './core/TimelineBase';
import { waitForElement, normalizeText, getScrollableAncestor } from './core/utils';

class DeepSeekTimeline extends TimelineBase {
	// Selectors
	private static SEL_MSG = '.ds-message';

	protected conversationContainer: HTMLElement | null = null;
	protected scrollContainer: HTMLElement | null = null;

	protected extractId(el: HTMLElement): string | null {
		// Priority: data-turn-id > data-um-id > legacy hash
		const turnId = el.dataset.turnId;
		if (turnId) return turnId;

		try {
			const owner = el.closest('[data-um-id]');
			const umId = owner?.getAttribute('data-um-id');
			if (umId) return `um:${umId}`;
		} catch { }

		// Fallback to hash-based ID (will be generated in rebuildMarkers)
		return null;
	}

	protected extractSummary(el: HTMLElement): string {
		return normalizeText(el.textContent || '');
	}

	protected getStarStorageKey(): string | null {
		if (!this.conversationId) return null;
		return `deepseekTimelineStars:${this.conversationId}`;
	}

	protected collectUserNodes(): HTMLElement[] {
		if (!this.conversationContainer) return [];

		// 核心逻辑：选择所有消息，然后过滤出用户消息
		const all = Array.from(this.conversationContainer.querySelectorAll(DeepSeekTimeline.SEL_MSG)) as HTMLElement[];
		return all.filter(el => this.detectIsUserMessage(el));
	}

	// Heuristic user-message detector (from original)
	private detectIsUserMessage(el: HTMLElement): boolean {
		// Priority 0: data-um-id block
		try {
			const owner = el.closest('[data-um-id]');
			if (owner) return true;
		} catch { }

		// Primary: user messages are followed by an actions toolbar
		try {
			const next = el.nextElementSibling;
			if (next) {
				if (next.querySelector('.ds-icon-button, .ds-icon-button__hover-bg')) return true;
				const btnLike = Array.from(next.querySelectorAll('[role="button"], button, [tabindex]'));
				if (btnLike.some(b => b.querySelector('.ds-icon'))) return true;
				if (next.querySelector('.ds-flex .ds-icon')) return true;
			}
		} catch { }

		// Geometry fallback: right-aligned bubbles
		try {
			const cRect = this.conversationContainer?.getBoundingClientRect();
			const r = el.getBoundingClientRect();
			if (cRect && r) {
				const centerX = r.left + r.width / 2;
				const midX = cRect.left + cRect.width / 2;
				if ((centerX - midX) >= 16) return true;
			}
		} catch { }

		return false;
	}

	protected async mount(): Promise<void> {
		const firstMsg = await waitForElement(DeepSeekTimeline.SEL_MSG);
		if (!firstMsg) return;

		// Find conversation root (lowest common ancestor)
		let root = null;
		try {
			const allMsgs = Array.from(document.querySelectorAll(DeepSeekTimeline.SEL_MSG));
			if (allMsgs.length > 0) {
				let node = firstMsg.parentElement;
				while (node && node !== document.body) {
					let allInside = true;
					for (let i = 0; i < allMsgs.length; i++) {
						const msg = allMsgs[i];
						if (msg && !node.contains(msg)) { allInside = false; break; }
					}
					if (allInside) { root = node; break; }
					// @ts-ignore
					node = node.parentElement;
				}
				if (!root) root = firstMsg.parentElement;
			}
		} catch { }

		this.conversationContainer = root || firstMsg.parentElement || document.body;
		this.scrollContainer = getScrollableAncestor(this.conversationContainer, '.ds-scroll-area') || document.body;

		// Extract conversation ID
		const segs = location.pathname.split('/');
		if (segs.includes('s')) {
			const idx = segs.indexOf('s');
			const id = segs[idx + 1];
			if (id) this.conversationId = id;
		}
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
let instance: DeepSeekTimeline | null = null;
let currentUrl = location.href;

function init() {
	if (instance) instance.destroy();
	instance = new DeepSeekTimeline();
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
		const i = segs.indexOf('s');
		// @ts-ignore
		const isConv = i !== -1 && segs[i + 1] && /^[A-Za-z0-9_-]+$/.test(segs[i + 1]);

		if (isConv) {
			setTimeout(init, 500);
		} else {
			if (instance) { instance.destroy(); instance = null; }
		}
	}
}

setInterval(checkRoute, 1000);
// Initial check
const segs = location.pathname.split('/').filter(Boolean);
if (segs.includes('s')) init();
