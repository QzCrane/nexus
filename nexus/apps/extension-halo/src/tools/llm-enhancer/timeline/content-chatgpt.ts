
import { TimelineBase } from './core/TimelineBase';
import { waitForElement, normalizeText } from './core/utils';

class ChatGPTTimeline extends TimelineBase {
	protected conversationContainer: HTMLElement | null = null;
	protected scrollContainer: HTMLElement | null = null;

	protected extractId(el: HTMLElement): string | null {
		return el.dataset.turnId || null;
	}

	protected extractSummary(el: HTMLElement): string {
		return normalizeText(el.textContent || '');
	}

	protected getStarStorageKey(): string | null {
		if (!this.conversationId) return null;
		return `chatgptTimelineStars:${this.conversationId}`;
	}

	protected collectUserNodes(): HTMLElement[] {
		if (!this.conversationContainer) return [];
		// 核心逻辑：选择所有用户回合（data-turn="user"）
		const userTurns = this.conversationContainer.querySelectorAll('article[data-turn="user"]');
		return Array.from(userTurns) as HTMLElement[];
	}

	protected async mount(): Promise<void> {
		// 等待第一个 turn 元素出现
		const firstTurn = await waitForElement('article[data-turn-id]');
		if (!firstTurn) return;

		// 找到对话容器（第一个 turn 的父元素）
		this.conversationContainer = firstTurn.parentElement;
		if (!this.conversationContainer) return;

		// 向上查找可滚动容器
		let parent = this.conversationContainer;
		while (parent && parent !== document.body) {
			const style = window.getComputedStyle(parent);
			if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
				this.scrollContainer = parent;
				break;
			}
			// @ts-ignore
			parent = parent.parentElement;
		}

		// 如果没找到，使用 document 作为滚动容器
		if (!this.scrollContainer) {
			this.scrollContainer = (document.scrollingElement as HTMLElement) || document.documentElement || document.body;
		}

		// 提取对话 ID
		this.conversationId = this.extractConversationId();
	}

	private extractConversationId(): string | null {
		const segs = location.pathname.split('/').filter(Boolean);
		const i = segs.indexOf('c');
		const val = segs[i + 1];
		if (i !== -1 && val) return val;
		return null;
	}

	protected startObservers() {
		// 监听对话容器的 DOM 变化
		if (this.conversationContainer) {
			const obs = new MutationObserver(() => {
				this.rebuildMarkers();
			});
			obs.observe(this.conversationContainer, { childList: true, subtree: true });
			this.observers.push(obs);
		}

		// 监听尺寸变化
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
let instance: ChatGPTTimeline | null = null;
let currentUrl = location.href;

function init() {
	if (instance) instance.destroy();
	instance = new ChatGPTTimeline();
	// IMPORTANT: init() FIRST to create UI, THEN set manager to trigger config sync
	instance.init();
	// @ts-ignore
	window.haloTimelineManager = instance;
	window.dispatchEvent(new CustomEvent('halo-timeline-ready'));
}

// Route monitoring
function checkRoute() {
	if (location.href !== currentUrl) {
		currentUrl = location.href;
		// Simple check for conversation route
		if (location.pathname.includes('/c/')) {
			setTimeout(init, 500);
		} else {
			if (instance) { instance.destroy(); instance = null; }
		}
	}
}

setInterval(checkRoute, 1000);
if (location.pathname.includes('/c/')) init();
