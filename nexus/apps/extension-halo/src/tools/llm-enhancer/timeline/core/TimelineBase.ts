
import { Marker, VisibleRange } from './types';
import { clamp01, getCSSVarNumber, isElementScrollable } from './utils';

export abstract class TimelineBase {
	// DOM refs
	protected abstract conversationContainer: HTMLElement | null;
	protected abstract scrollContainer: HTMLElement | null;
	protected timelineBar: HTMLElement | null = null;
	protected track: HTMLElement | null = null;
	protected trackContent: HTMLElement | null = null;

	// UI
	protected ui: {
		slider: HTMLElement | null;
		handle: HTMLElement | null;
		tooltip: HTMLElement | null;
	} = {
			slider: null,
			handle: null,
			tooltip: null
		};
	private measureEl: HTMLElement | null = null;

	// State
	protected markers: Marker[] = [];
	protected contentHeight = 0;
	protected yPositions: number[] = [];
	protected firstOffset = 0;
	protected spanPx = 1;

	// Virtualization
	protected visibleRange: VisibleRange = { start: 0, end: -1 };
	private usePixelTop = false;
	private _cssVarTopSupported: boolean | null = null;

	// Active State
	protected activeIdx = -1;
	protected activeTurnId: string | null = null;
	protected starred = new Set<string>();
	protected conversationId: string | null = null;

	// Interaction
	private onScrollBound: (() => void) | null = null;
	private scrollRafId: number | null = null;
	private isScrolling = false;

	// Tooltip & Slider interactions
	private sliderDragging = false;
	private sliderStartClientY = 0;
	private sliderStartTop = 0;
	private onSliderMoveBound: ((e: PointerEvent) => void) | null = null;
	private onSliderUpBound: ((e: PointerEvent) => void) | null = null;
	private sliderFadeTimer: any = null;
	private sliderAlwaysVisible = false;

	// Long-press star (from original)
	private longPressDuration = 550;
	private longPressMoveTolerance = 6;
	private longPressTimer: any = null;
	private pressStartPos: { x: number, y: number } | null = null;
	private pressTargetDot: HTMLElement | null = null;
	private suppressClickUntil = 0;
	private longPressTriggered = false;

	// Generic Obs
	protected observers: (MutationObserver | ResizeObserver | IntersectionObserver)[] = [];
	protected listeners: Array<{ target: EventTarget, type: string, listener: EventListenerOrEventListenerObject }> = [];

	private lastActiveChangeTime = 0;
	private minActiveChangeInterval = 120;
	private pendingActiveId: string | null = null;
	private activeChangeTimer: any = null;

	// Event handlers (stable refs)
	private onTimelineBarClick: ((e: Event) => void) | null = null;
	private onPointerDown: ((e: PointerEvent) => void) | null = null;
	private onPointerMove: ((e: PointerEvent) => void) | null = null;
	private onPointerUp: ((e: PointerEvent) => void) | null = null;
	private onPointerLeave: ((e: PointerEvent) => void) | null = null;
	private onStorage: ((e: StorageEvent) => void) | null = null;

	constructor() {
		// Base setup
	}

	// === Public API for Halo ===
	public setVisible(visible: boolean) {
		// Use CSS class on body to control visibility (avoids race conditions)
		document.body.classList.toggle('halo-timeline-active', visible);
	}

	public destroy() {
		this.disconnectObservers();
		this.removeListeners();
		this.removeUI();
		// @ts-ignore
		window.haloTimelineManager = null;

		if (this.scrollRafId) { cancelAnimationFrame(this.scrollRafId); this.scrollRafId = null; }
		if (this.sliderFadeTimer) { clearTimeout(this.sliderFadeTimer); this.sliderFadeTimer = null; }
		if (this.activeChangeTimer) { clearTimeout(this.activeChangeTimer); this.activeChangeTimer = null; }
		if (this.longPressTimer) { clearTimeout(this.longPressTimer); this.longPressTimer = null; }
	}

	public async init() {
		await this.mount(); // Wait for DOM
		this.injectUI();
		this.loadStars();
		this.rebuildMarkers();
		this.startObservers();
		this.attachInteractions();
		this.attachScrollSync();
		this.attachStorageSync();
	}

	// === Abstracts ===
	protected abstract collectUserNodes(): HTMLElement[];
	protected abstract extractId(el: HTMLElement): string | null;
	protected abstract extractSummary(el: HTMLElement): string;
	protected abstract getStarStorageKey(): string | null;

	// === UI scaffolding ===
	protected injectUI() {
		// Bar
		let bar = document.querySelector('.chatgpt-timeline-bar') as HTMLElement;
		if (!bar) {
			bar = document.createElement('div');
			bar.className = 'chatgpt-timeline-bar';
			document.body.appendChild(bar);
		}
		this.timelineBar = bar;

		// Track
		let track = bar.querySelector('.timeline-track') as HTMLElement;
		if (!track) {
			track = document.createElement('div');
			track.className = 'timeline-track';
			bar.appendChild(track);
		}

		let content = track.querySelector('.timeline-track-content') as HTMLElement;
		if (!content) {
			content = document.createElement('div');
			content.className = 'timeline-track-content';
			track.appendChild(content);
		}
		this.track = track;
		this.trackContent = content;

		// Slider
		let slider = document.querySelector('.timeline-left-slider') as HTMLElement;
		if (!slider) {
			slider = document.createElement('div');
			slider.className = 'timeline-left-slider';
			const h = document.createElement('div');
			h.className = 'timeline-left-handle';
			slider.appendChild(h);
			document.body.appendChild(slider);
		}
		this.ui.slider = slider;
		this.ui.handle = slider.querySelector('.timeline-left-handle') as HTMLElement;

		// Tooltip
		if (!this.ui.tooltip) {
			const tip = document.createElement('div');
			tip.className = 'timeline-tooltip';
			tip.setAttribute('role', 'tooltip');
			tip.id = 'chatgpt-timeline-tooltip';
			tip.setAttribute('aria-hidden', 'true');
			// Critical: prevent tooltip from blocking clicks
			tip.style.pointerEvents = 'none';
			document.body.appendChild(tip);
			this.ui.tooltip = tip;
			this.createMeasureEl(tip);
		}

		// Initial Event Listeners for UI
		if (this.ui.slider) {
			this.ui.slider.addEventListener('pointerenter', () => this.showSlider());
			this.ui.slider.addEventListener('pointerleave', () => this.hideSliderDeferred());
		}
		if (this.ui.handle) {
			this.ui.handle.addEventListener('pointerdown', (e) => this.startSliderDrag(e));
		}
	}

	private createMeasureEl(ref: HTMLElement) {
		if (this.measureEl) return;
		try {
			const m = document.createElement('div');
			m.setAttribute('aria-hidden', 'true');
			Object.assign(m.style, {
				position: 'fixed', left: '-9999px', top: '0', visibility: 'hidden', pointerEvents: 'none',
				width: 'auto', height: 'auto', whiteSpace: 'normal', wordBreak: 'break-word', maxWidth: 'none',
				transform: 'none', transition: 'none'
			});
			const cs = getComputedStyle(ref);
			['backgroundColor', 'color', 'fontFamily', 'fontSize', 'lineHeight', 'padding', 'border', 'borderRadius'].forEach(k => {
				// @ts-ignore
				m.style[k] = cs[k];
			});
			document.body.appendChild(m);
			this.measureEl = m;
		} catch { }
	}

	// === Core Logic ===
	protected rebuildMarkers() {
		if (!this.conversationContainer || !this.trackContent || !this.scrollContainer) return;
		// Clear DOM
		try { this.trackContent.querySelectorAll('.timeline-dot').forEach(n => n.remove()); } catch { }

		const nodes = this.collectUserNodes();
		if (nodes.length === 0) return;

		// Geometry relative to scroll container
		const cRect = this.scrollContainer.getBoundingClientRect();
		const st = this.scrollContainer.scrollTop;
		const ys = nodes.map(el => (el.getBoundingClientRect().top - cRect.top) + st);

		const firstY = ys[0] ?? 0;
		const lastY = (ys.length > 1) ? (ys[ys.length - 1] ?? 0) : (firstY + 1);
		const span = Math.max(1, lastY - firstY);
		this.firstOffset = firstY;
		this.spanPx = span;

		// Create markers
		this.markers = nodes.map((el, i) => {
			const y = ys[i] ?? 0;
			const n = clamp01((y - firstY) / span);
			const id = this.extractId(el) || `legacy-${i}`;
			const summary = this.extractSummary(el);
			return {
				id, el, n, baseN: n, summary,
				starred: this.starred.has(id),
				dotElement: null
			};
		});

		this.updateTimelineGeometry();
		this.updateVirtualRangeAndRender();
		this.syncTimelineTrackToMain();
		this.scheduleScrollSync(); // Update active
	}

	protected updateTimelineGeometry() {
		if (!this.timelineBar || !this.trackContent) return;
		const H = this.timelineBar.clientHeight || 0;
		const pad = getCSSVarNumber(this.timelineBar, '--timeline-track-padding', 16);
		const minGap = getCSSVarNumber(this.timelineBar, '--timeline-min-gap', 24);
		const N = this.markers.length;

		const desired = Math.max(H, (N > 0) ? (2 * pad + Math.max(0, N - 1) * minGap) : H);
		this.contentHeight = Math.ceil(desired);
		this.trackContent.style.height = `${this.contentHeight}px`;

		const usableC = Math.max(1, this.contentHeight - 2 * pad);
		// Min-Gap Logic
		const desiredY = this.markers.map(m => pad + clamp01(m.baseN) * usableC);
		this.yPositions = this.applyMinGap(desiredY, pad, pad + usableC, minGap);

		// Update markers normalized pos
		this.markers.forEach((m, i) => {
			const n = clamp01(((this.yPositions[i] ?? 0) - pad) / usableC);
			m.n = n;
			if (m.dotElement && !this.usePixelTop) {
				m.dotElement.style.setProperty('--n', String(n));
			}
		});

		if (this._cssVarTopSupported === null) {
			this._cssVarTopSupported = this.detectCssVarTopSupport(pad, usableC);
			this.usePixelTop = !this._cssVarTopSupported;
		}

		// Slider visibility
		this.updateSlider();
	}

	private applyMinGap(pos: number[], min: number, max: number, gap: number): number[] {
		const n = pos.length;
		if (n === 0) return pos;
		const out = pos.slice();
		out[0] = Math.max(min, Math.min(pos[0] ?? 0, max));
		for (let i = 1; i < n; i++) {
			out[i] = Math.max(pos[i] ?? 0, (out[i - 1] ?? 0) + gap);
		}
		if ((out[n - 1] ?? 0) > max) {
			out[n - 1] = max;
			for (let i = n - 2; i >= 0; i--) {
				out[i] = Math.min(out[i] ?? 0, (out[i + 1] ?? 0) - gap);
			}
			if ((out[0] ?? 0) < min) { // Shift forward again if pushed back too far
				out[0] = min;
				for (let i = 1; i < n; i++) out[i] = Math.max(out[i] ?? 0, (out[i - 1] ?? 0) + gap);
			}
		}
		// Clamp final
		for (let i = 0; i < n; i++) out[i] = Math.max(min, Math.min(max, out[i] ?? 0));
		return out;
	}

	private detectCssVarTopSupport(pad: number, usable: number): boolean {
		try {
			if (!this.trackContent) return false;
			const t = document.createElement('div');
			t.className = 'timeline-dot';
			t.style.setProperty('--n', '0.5');
			this.trackContent.appendChild(t);
			const px = parseFloat(getComputedStyle(t).top || '');
			t.remove();
			return Math.abs(px - (pad + 0.5 * usable)) <= 2;
		} catch { return false; }
	}

	protected updateVirtualRangeAndRender() {
		if (!this.track || !this.trackContent) return;
		const st = this.track.scrollTop;
		const h = this.track.clientHeight;
		const buf = Math.max(100, h); // Render buffer
		const minYs = st - buf;
		const maxYs = st + h + buf;

		const startIdx = this.lowerBound(this.yPositions, minYs);
		const endIdx = Math.max(startIdx - 1, this.upperBound(this.yPositions, maxYs));

		const { start: prevStart, end: prevEnd } = this.visibleRange;
		const frag = document.createDocumentFragment();

		for (let i = startIdx; i <= endIdx; i++) {
			const m = this.markers[i];
			if (!m) continue;

			if (!m.dotElement) {
				const d = document.createElement('button');
				d.className = 'timeline-dot';
				// Store marker ID (not turn ID) for lookup
				d.dataset.targetIdx = m.id;
				if (m.starred) { d.classList.add('starred'); d.setAttribute('aria-pressed', 'true'); }
				if (m.id === this.activeTurnId) d.classList.add('active');
				d.setAttribute('aria-label', m.summary);

				if (this.usePixelTop) d.style.top = `${Math.round(this.yPositions[i] ?? 0)}px`;
				else d.style.setProperty('--n', String(m.n));

				// Tooltip handlers
				this.attachTooltipHandlers(d, m);

				m.dotElement = d;
				frag.appendChild(d);
			} else {
				// Update existing
				if (this.usePixelTop) m.dotElement.style.top = `${Math.round(this.yPositions[i] ?? 0)}px`;
				else m.dotElement.style.setProperty('--n', String(m.n));
			}
		}
		if (frag.childNodes.length) this.trackContent.appendChild(frag);

		// Cleanup out of range
		if (prevEnd >= prevStart) {
			for (let i = prevStart; i < Math.min(startIdx, prevEnd + 1); i++) this.removeDot(i);
			for (let i = Math.max(endIdx + 1, prevStart); i <= prevEnd; i++) this.removeDot(i);
		} else {
			// Clear all (unlikely path)
			this.markers.forEach((_, i) => this.removeDot(i));
		}
		this.visibleRange = { start: startIdx, end: endIdx };
	}

	private removeDot(i: number) {
		if (i >= 0 && i < this.markers.length) {
			const m = this.markers[i];
			if (m && m.dotElement) { m.dotElement.remove(); m.dotElement = null; }
		}
	}

	private lowerBound(arr: number[], x: number): number {
		let lo = 0, hi = arr.length;
		while (lo < hi) { const mid = (lo + hi) >> 1; if ((arr[mid] ?? 0) < x) lo = mid + 1; else hi = mid; }
		return lo;
	}
	private upperBound(arr: number[], x: number): number {
		let lo = 0, hi = arr.length;
		while (lo < hi) { const mid = (lo + hi) >> 1; if ((arr[mid] ?? 0) <= x) lo = mid + 1; else hi = mid; }
		return lo - 1;
	}

	// === Interactions ===
	private attachTooltipHandlers(el: HTMLElement, m: Marker) {
		let hideTimer: any = null;
		el.onmouseenter = () => {
			if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
			this.showTooltip(m, el);
		};
		el.onmouseleave = () => {
			// Delay hide to prevent flicker when moving between dots
			hideTimer = setTimeout(() => this.hideTooltip(), 100);
		};
	}

	protected showTooltip(m: Marker, el: HTMLElement) {
		if (!this.ui.tooltip) return;
		this.ui.tooltip.textContent = (m.starred ? '★ ' : '') + m.summary;
		this.ui.tooltip.classList.add('visible');
		this.ui.tooltip.setAttribute('aria-hidden', 'false');

		// Detailed placement logic
		const dotRect = el.getBoundingClientRect();
		const tipW = this.ui.tooltip.offsetWidth;
		// Simplified for reliability: Align right of dot, fallback left
		const pad = 12;
		let left = dotRect.right + pad;
		if (left + tipW > window.innerWidth) {
			left = dotRect.left - tipW - pad;
		}
		this.ui.tooltip.style.left = `${left}px`;
		this.ui.tooltip.style.top = `${dotRect.top}px`;
	}

	protected hideTooltip() {
		if (this.ui.tooltip) {
			this.ui.tooltip.classList.remove('visible');
			this.ui.tooltip.setAttribute('aria-hidden', 'true');
		}
	}

	// === Scroll Sync ===
	protected attachScrollSync() {
		if (!this.scrollContainer) return;
		this.onScrollBound = () => this.scheduleScrollSync();
		this.scrollContainer.addEventListener('scroll', this.onScrollBound, { passive: true });
		// Listen on window for general scrolling just in case
		window.addEventListener('scroll', this.onScrollBound, { passive: true }); // simplified

		this.track?.addEventListener('scroll', () => {
			// Virtual range update on track scroll
			this.updateVirtualRangeAndRender();
		}, { passive: true });
	}

	protected scheduleScrollSync() {
		if (this.scrollRafId) return;
		this.scrollRafId = requestAnimationFrame(() => {
			this.scrollRafId = null;
			this.syncTimelineTrackToMain();
			this.computeActiveByScroll(); // updates activeIdx
			this.updateActiveDotUI();
		});
	}

	protected syncTimelineTrackToMain() {
		if (!this.scrollContainer || !this.track) return;
		// Bi-directional sync? Usually just Main -> Track (unless dragging slider)
		if (this.sliderDragging) return; // Don't fight drag

		const st = this.scrollContainer.scrollTop;
		const sh = this.scrollContainer.scrollHeight;
		const ch = this.scrollContainer.clientHeight;

		const trackSH = this.track.scrollHeight;
		const trackCH = this.track.clientHeight;

		const pct = st / Math.max(1, sh - ch);
		this.track.scrollTop = pct * (trackSH - trackCH);
	}

	protected computeActiveByScroll() {
		if (!this.scrollContainer || this.markers.length === 0) return;

		// Guard against missing bar/ui
		if (!this.timelineBar) return;

		const containerRect = this.scrollContainer.getBoundingClientRect();
		const scrollTop = this.scrollContainer.scrollTop;
		const ref = scrollTop + this.timelineBar.getBoundingClientRect().top + (this.scrollContainer.clientHeight * 0.45);

		let activeId = this.markers[0]?.id;
		if (!activeId) return;

		let idx = 0;
		for (let i = 0; i < this.markers.length; i++) {
			const m = this.markers[i];
			if (!m) continue;
			const mTop = (m.el.getBoundingClientRect().top - containerRect.top) + scrollTop;
			// Simplified check vs original logic
			if (mTop <= ref) {
				activeId = m.id;
				idx = i;
			} else {
				break;
			}
		}

		if (this.activeTurnId !== activeId) {
			const now = Date.now();
			const since = now - this.lastActiveChangeTime;
			if (since < this.minActiveChangeInterval) {
				this.pendingActiveId = activeId;
				if (!this.activeChangeTimer) {
					this.activeChangeTimer = setTimeout(() => {
						this.activeChangeTimer = null;
						if (this.pendingActiveId && this.pendingActiveId !== this.activeTurnId) {
							this.commitActive(this.pendingActiveId);
						}
						this.pendingActiveId = null;
					}, Math.max(0, this.minActiveChangeInterval - since));
				}
			} else {
				this.commitActive(activeId);
			}
		}
		this.activeIdx = idx; // sync internal index
	}

	private commitActive(id: string) {
		this.activeTurnId = id;
		this.updateActiveDotUI();
		this.lastActiveChangeTime = Date.now();
	}

	protected updateActiveDotUI() {
		this.markers.forEach((m) => {
			if (m.dotElement) m.dotElement.classList.toggle('active', m.id === this.activeTurnId);
		});
	}

	// === Smooth Scroll (from original) ===
	protected scrollTo(el: HTMLElement) {
		this.smoothScrollTo(el, 600);
	}

	private smoothScrollTo(targetElement: HTMLElement, duration = 600) {
		if (!this.scrollContainer) return;

		const containerRect = this.scrollContainer.getBoundingClientRect();
		const targetRect = targetElement.getBoundingClientRect();
		const targetPosition = targetRect.top - containerRect.top + this.scrollContainer.scrollTop;
		const startPosition = this.scrollContainer.scrollTop;
		const distance = targetPosition - startPosition;
		let startTime: number | null = null;

		const animation = (currentTime: number) => {
			this.isScrolling = true;
			if (startTime === null) startTime = currentTime;
			const timeElapsed = currentTime - startTime;
			const run = this.easeInOutQuad(timeElapsed, startPosition, distance, duration);
			this.scrollContainer!.scrollTop = run;
			if (timeElapsed < duration) {
				requestAnimationFrame(animation);
			} else {
				this.scrollContainer!.scrollTop = targetPosition;
				this.isScrolling = false;
			}
		};
		requestAnimationFrame(animation);
	}

	private easeInOutQuad(t: number, b: number, c: number, d: number): number {
		t /= d / 2;
		if (t < 1) return c / 2 * t * t + b;
		t--;
		return -c / 2 * (t * (t - 2) - 1) + b;
	}

	// === Slider ===
	protected updateSlider() {
		if (!this.ui.slider || !this.ui.handle || !this.timelineBar || !this.track) return;
		const barRect = this.timelineBar.getBoundingClientRect();
		const pad = getCSSVarNumber(this.timelineBar, '--timeline-track-padding', 16);
		const barH = barRect.height || 0;

		if (this.contentHeight <= barH + 1) {
			this.sliderAlwaysVisible = false;
			this.ui.slider.classList.remove('visible');
			return;
		}
		this.sliderAlwaysVisible = true;

		const railLen = Math.max(120, Math.min(240, Math.floor(barH * 0.45)));
		const innerH = Math.max(0, barH - 2 * pad);
		const railTop = Math.round(barRect.top - document.body.getBoundingClientRect().top + pad + (innerH - railLen) / 2);

		this.ui.slider.style.top = `${railTop}px`; // Assume fixed
		this.ui.slider.style.height = `${railLen}px`;

		const handleH = 22;
		const maxTop = Math.max(0, railLen - handleH);
		const range = Math.max(1, this.contentHeight - barH);
		const st = this.track.scrollTop || 0;
		const r = Math.max(0, Math.min(1, st / range));

		this.ui.handle.style.top = `${Math.round(r * maxTop)}px`;
		this.ui.slider.classList.add('visible');
	}

	private startSliderDrag(e: PointerEvent) {
		this.sliderDragging = true;
		this.sliderStartClientY = e.clientY;
		this.sliderStartTop = parseFloat(this.ui.handle!.style.top || '0');

		this.onSliderMoveBound = (ev) => this.handleSliderDrag(ev);
		this.onSliderUpBound = (ev) => this.endSliderDrag(ev);

		window.addEventListener('pointermove', this.onSliderMoveBound);
		window.addEventListener('pointerup', this.onSliderUpBound!);
		window.addEventListener('pointercancel', this.onSliderUpBound!);
	}

	private handleSliderDrag(e: PointerEvent) {
		if (!this.sliderDragging || !this.ui.handle) return;
		const delta = e.clientY - this.sliderStartClientY;
		const railLen = parseFloat(this.ui.slider!.style.height || '0');
		const handleH = 22;
		const maxTop = Math.max(0, railLen - handleH);

		let top = Math.max(0, Math.min(maxTop, this.sliderStartTop + delta));
		const r = maxTop > 0 ? top / maxTop : 0;

		const barH = this.timelineBar!.clientHeight;
		const range = Math.max(1, this.contentHeight - barH);
		this.track!.scrollTop = Math.round(r * range);
		// Manual sync needed since scroll event might be async or suppressed
		this.updateVirtualRangeAndRender();
	}

	private endSliderDrag(e: PointerEvent) {
		this.sliderDragging = false;
		window.removeEventListener('pointermove', this.onSliderMoveBound!);
		window.removeEventListener('pointerup', this.onSliderUpBound!);
		window.removeEventListener('pointercancel', this.onSliderUpBound!);
		this.hideSliderDeferred();
	}

	private showSlider() {
		this.ui.slider?.classList.add('visible');
		if (this.sliderFadeTimer) clearTimeout(this.sliderFadeTimer);
	}

	private hideSliderDeferred() {
		if (this.sliderDragging || this.sliderAlwaysVisible) return;
		this.sliderFadeTimer = setTimeout(() => {
			this.ui.slider?.classList.remove('visible');
		}, 1000);
	}

	// === Long-press Star (from original) ===
	protected attachInteractions() {
		if (!this.timelineBar) return;

		// Click handler (delegated)
		this.onTimelineBarClick = (e: Event) => {
			const dot = (e.target as HTMLElement).closest('.timeline-dot') as HTMLElement;
			if (dot) {
				const now = Date.now();
				if (now < this.suppressClickUntil) {
					try { e.preventDefault(); e.stopPropagation(); } catch { }
					return;
				}
				const targetIdx = dot.dataset.targetIdx;
				if (targetIdx) {
					// Find marker by ID (Gemini pattern)
					const marker = this.markers.find(m => m.id === targetIdx);
					if (marker?.el) {
						this.scrollTo(marker.el);
					}
				}
			}
		};
		this.timelineBar.addEventListener('click', this.onTimelineBarClick);

		// Long-press gesture (delegated)
		this.onPointerDown = (ev: PointerEvent) => {
			const dot = (ev.target as HTMLElement)?.closest?.('.timeline-dot') as HTMLElement;
			if (!dot) return;
			if (typeof ev.button === 'number' && ev.button !== 0) return; // left button only
			this.cancelLongPress();
			this.pressTargetDot = dot;
			this.pressStartPos = { x: ev.clientX, y: ev.clientY };
			try { dot.classList.add('holding'); } catch { }
			this.longPressTriggered = false;
			this.longPressTimer = setTimeout(() => {
				this.longPressTimer = null;
				if (!this.pressTargetDot) return;
				const id = this.pressTargetDot.dataset.targetIdx;
				if (id) this.toggleStar(id);
				this.longPressTriggered = true;
				this.suppressClickUntil = Date.now() + 350;
				try { this.pressTargetDot.classList.remove('holding'); } catch { }
			}, this.longPressDuration);
		};
		this.timelineBar.addEventListener('pointerdown', this.onPointerDown);

		this.onPointerMove = (ev: PointerEvent) => {
			if (!this.pressTargetDot || !this.pressStartPos) return;
			const dx = ev.clientX - this.pressStartPos.x;
			const dy = ev.clientY - this.pressStartPos.y;
			if (Math.abs(dx) > this.longPressMoveTolerance || Math.abs(dy) > this.longPressMoveTolerance) {
				this.cancelLongPress();
			}
		};
		window.addEventListener('pointermove', this.onPointerMove);

		this.onPointerUp = (ev: PointerEvent) => {
			this.cancelLongPress();
		};
		window.addEventListener('pointerup', this.onPointerUp);

		this.onPointerLeave = (ev: PointerEvent) => {
			if (!this.timelineBar?.contains(ev.target as Node)) {
				this.cancelLongPress();
			}
		};
		this.timelineBar.addEventListener('pointerleave', this.onPointerLeave);
	}

	private cancelLongPress() {
		if (this.longPressTimer) { clearTimeout(this.longPressTimer); this.longPressTimer = null; }
		if (this.pressTargetDot) {
			try { this.pressTargetDot.classList.remove('holding'); } catch { }
			this.pressTargetDot = null;
		}
		this.pressStartPos = null;
	}

	private toggleStar(id: string) {
		if (this.starred.has(id)) {
			this.starred.delete(id);
		} else {
			this.starred.add(id);
		}
		this.saveStars();

		// Update UI
		const marker = this.markers.find(m => m.id === id);
		if (marker) {
			marker.starred = this.starred.has(id);
			if (marker.dotElement) {
				marker.dotElement.classList.toggle('starred', marker.starred);
				marker.dotElement.setAttribute('aria-pressed', marker.starred ? 'true' : 'false');
			}
		}
	}

	// === Storage ===
	protected loadStars() {
		const k = this.getStarStorageKey();
		if (!k) return;
		const raw = localStorage.getItem(k);
		if (raw) {
			try { this.starred = new Set(JSON.parse(raw)); } catch { }
		}
	}

	protected saveStars() {
		const k = this.getStarStorageKey();
		if (!k) return;
		localStorage.setItem(k, JSON.stringify(Array.from(this.starred)));
	}

	// Cross-tab star sync
	protected attachStorageSync() {
		this.onStorage = (e: StorageEvent) => {
			if (!e || e.storageArea !== localStorage) return;
			const k = this.getStarStorageKey();
			if (!k || e.key !== k) return;

			let nextArr: string[] = [];
			try { nextArr = JSON.parse(e.newValue || '[]') || []; } catch { nextArr = []; }
			const nextSet = new Set(nextArr.map(x => String(x)));

			// Quick equality check
			if (nextSet.size === this.starred.size) {
				let same = true;
				for (const id of this.starred) { if (!nextSet.has(id)) { same = false; break; } }
				if (same) return;
			}

			this.starred = nextSet;
			// Update all markers
			for (let i = 0; i < this.markers.length; i++) {
				const m = this.markers[i];
				if (!m) continue;
				const want = this.starred.has(m.id);
				if (m.starred !== want) {
					m.starred = want;
					if (m.dotElement) {
						try {
							m.dotElement.classList.toggle('starred', m.starred);
							m.dotElement.setAttribute('aria-pressed', m.starred ? 'true' : 'false');
						} catch { }
					}
				}
			}
		};
		window.addEventListener('storage', this.onStorage);
	}

	// Helper
	protected addListener(target: EventTarget, type: string, listener: EventListenerOrEventListenerObject) {
		target.addEventListener(type, listener);
		this.listeners.push({ target, type, listener });
	}

	protected removeListeners() {
		this.listeners.forEach(l => l.target.removeEventListener(l.type, l.listener));
		this.listeners = [];
		if (this.onScrollBound && this.scrollContainer) this.scrollContainer.removeEventListener('scroll', this.onScrollBound);
		if (this.onScrollBound) window.removeEventListener('scroll', this.onScrollBound);
		if (this.onTimelineBarClick && this.timelineBar) this.timelineBar.removeEventListener('click', this.onTimelineBarClick);
		if (this.onPointerDown && this.timelineBar) this.timelineBar.removeEventListener('pointerdown', this.onPointerDown);
		if (this.onPointerMove) window.removeEventListener('pointermove', this.onPointerMove);
		if (this.onPointerUp) window.removeEventListener('pointerup', this.onPointerUp);
		if (this.onPointerLeave && this.timelineBar) this.timelineBar.removeEventListener('pointerleave', this.onPointerLeave);
		if (this.onStorage) window.removeEventListener('storage', this.onStorage);
	}

	protected disconnectObservers() {
		this.observers.forEach(o => o.disconnect());
		this.observers = [];
	}

	private removeUI() {
		this.timelineBar?.remove();
		this.ui.slider?.remove();
		this.ui.tooltip?.remove();
		this.measureEl?.remove();
	}

	// Default lifecycle
	protected mount(): Promise<void> {
		return Promise.resolve();
	}
	protected startObservers(): void {
		// Implemented by subclasses
	}
}
