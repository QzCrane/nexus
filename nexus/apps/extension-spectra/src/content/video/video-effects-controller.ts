// goal: reversible extension-owned video presentation effects that preserve site-authored inline styles

import type { ControlField, ControlValues, VideoFilterState } from '@nexus/contracts';
import { UI_COLORS } from '../../shared/ui-colors';
import {
	abortError,
	ContentLifecycleError,
} from '../core/content-runtime-context';

const OWNER_ATTRIBUTE = 'data-spectra-video-effects-owner';

function styleText(ownerToken: string): string {
	const selector = `video[${OWNER_ATTRIBUTE}="${ownerToken}"]`;
	return `${selector}[${OWNER_ATTRIBUTES[1]}]{rotate:var(${OWNER_PROPERTIES[0]})!important}`
		+ `${selector}[${OWNER_ATTRIBUTES[2]}]{scale:var(${OWNER_PROPERTIES[1]}) var(${OWNER_PROPERTIES[2]})!important}`
		+ `${selector}[${OWNER_ATTRIBUTES[3]}]{object-fit:cover!important}`
		+ `${selector}[${OWNER_ATTRIBUTES[4]}]{filter:var(${OWNER_PROPERTIES[3]})!important}`;
}

const OWNER_ATTRIBUTES = [
	OWNER_ATTRIBUTE,
	'data-spectra-rotate',
	'data-spectra-scale',
	'data-spectra-fill',
	'data-spectra-filter',
] as const;
const OWNER_PROPERTIES = [
	'--spectra-rotate',
	'--spectra-scale-x',
	'--spectra-scale-y',
	'--spectra-filter',
] as const;
const DIM_EVENTS = ['resize', 'scroll'] as const;
const CANCELLED = 'cancelled';
const STALE_MEDIA_SOURCE = 'stale-media-source';
const DEADLINE_EXCEEDED = 'deadline-exceeded';

function readbackError(detail: string): Error {
	return new Error(`Video ${detail} readback failed`);
}

interface VideoOwnerBaseline {
	attributes: Map<string, string | null>;
	properties: Map<string, { value: string; priority: string }>;
}

export interface VideoEffectApplyOptions {
	signal?: AbortSignal;
	deadlineMs?: number;
	isCurrent?: () => boolean;
}

interface PendingDimReadback {
	video: HTMLVideoElement;
	cancel(error: ContentLifecycleError): void;
}

export interface VideoEffectState {
	rotation: 0 | 90 | 180 | 270;
	mirrored: boolean;
	fill: boolean;
	filterEnabled: boolean;
	filter: VideoFilterState;
	dimEnabled: boolean;
	dimOpacity: number;
}

const DEFAULT_FILTER: VideoFilterState = {
	brightness: 100,
	contrast: 100,
	saturate: 100,
	grayscale: false,
	invert: false,
};

/**
 * Field-by-field because `JSON.stringify` compares key order too: a filter
 * rebuilt through a different literal would look configured while carrying the
 * default values, which kept DOM ownership alive for an effect nobody enabled
 * (SP-74).
 */
function matchesDefaultFilter(filter: VideoFilterState): boolean {
	return filter.brightness === DEFAULT_FILTER.brightness
		&& filter.contrast === DEFAULT_FILTER.contrast
		&& filter.saturate === DEFAULT_FILTER.saturate
		&& filter.grayscale === DEFAULT_FILTER.grayscale
		&& filter.invert === DEFAULT_FILTER.invert;
}

const DEFAULT_STATE: VideoEffectState = {
	rotation: 0,
	mirrored: false,
	fill: false,
	filterEnabled: false,
	filter: DEFAULT_FILTER,
	dimEnabled: false,
	dimOpacity: 0.7,
};

function defaultState(): VideoEffectState {
	return { ...DEFAULT_STATE, filter: { ...DEFAULT_FILTER } };
}

export class VideoEffectsController {
	readonly #ownerToken = crypto.randomUUID();
	readonly #states = new WeakMap<HTMLVideoElement, VideoEffectState>();
	readonly #filterBaselines = new WeakMap<HTMLVideoElement, string>();
	readonly #ownerBaselines = new WeakMap<HTMLVideoElement, VideoOwnerBaseline>();
	readonly #owned = new Set<HTMLVideoElement>();
	readonly #cssOwned = new Set<HTMLVideoElement>();
	#styleElement: HTMLStyleElement | null = null;
	#dimHost: HTMLDivElement | null = null;
	#dimRegions: HTMLDivElement[] = [];
	#dimTarget: HTMLVideoElement | null = null;
	#dimOpacity = 0.7;
	#resizeObserver: ResizeObserver | null = null;
	#rotationObserver: ResizeObserver | null = null;
	#frameId = 0;
	#disposed = false;
	readonly #pendingDimReadbacks = new Set<PendingDimReadback>();

	#dimBoxes(video: HTMLVideoElement): Array<readonly [number, number, number, number]> {
		const rect = video.getBoundingClientRect();
		const viewport = window.visualViewport;
		const width = viewport?.width ?? document.documentElement.clientWidth;
		const height = viewport?.height ?? document.documentElement.clientHeight;
		const offsetLeft = viewport?.offsetLeft ?? 0;
		const offsetTop = viewport?.offsetTop ?? 0;
		const top = Math.max(0, Math.min(height, rect.top - offsetTop));
		const bottom = Math.max(top, Math.min(height, rect.bottom - offsetTop));
		const left = Math.max(0, Math.min(width, rect.left - offsetLeft));
		const right = Math.max(left, Math.min(width, rect.right - offsetLeft));
		return [
			[0, 0, width, top],
			[0, top, left, bottom - top],
			[right, top, width - right, bottom - top],
			[0, bottom, width, height - bottom],
		];
	}

	#state(video: HTMLVideoElement): VideoEffectState {
		let state = this.#states.get(video);
		if (!state) {
			state = defaultState();
			this.#states.set(video, state);
		}
		return state;
	}

	snapshot(video: HTMLVideoElement): VideoEffectState {
		// Status/read paths are projections only. Do not allocate target ownership
		// state merely because Popup or remote asks for the current native view.
		const state = this.#states.get(video) ?? DEFAULT_STATE;
		return { ...state, filter: { ...state.filter } };
	}

	#ensureStyle(): void {
		if (this.#styleElement?.isConnected) return;
		const style = document.createElement('style');
		style.dataset.spectraOwner = 'video-effects';
		style.textContent = styleText(this.#ownerToken);
		(document.head ?? document.documentElement).appendChild(style);
		this.#styleElement = style;
	}

	async apply<K extends Extract<ControlField,
		'rotation' | 'mirrored' | 'fill' | 'filterEnabled' | 'filter' | 'dimEnabled' | 'dimOpacity'>>(
		video: HTMLVideoElement,
		field: K,
		value: ControlValues[K],
		options: VideoEffectApplyOptions = {},
	): Promise<ControlValues[K]> {
		this.#assertCurrent(options);
		const state = this.#state(video);
		if (field === 'dimEnabled' || field === 'dimOpacity') {
			const previous = { ...state };
			try {
				if (field === 'dimEnabled') state.dimEnabled = value as boolean;
				else state.dimOpacity = value as number;
				if (state.dimEnabled) this.#owned.add(video);
				this.#applyDim(video, state.dimEnabled, state.dimOpacity);
				await this.#settleDimReadback(video, state, options);
				this.#assertCurrent(options);
				const actual = state[field] as ControlValues[K];
				this.#commit(video, state);
				return actual;
			} catch (error) {
				// A timed-out/cancelled overlay must not leave an enabled state with no
				// geometry owner. Restore the logical state and tear down the overlay;
				// callers receive the typed lifecycle/deadline failure instead of ACKing
				// the uncommitted value.
				Object.assign(state, previous);
				this.#disposeDim();
				if (!this.#disposed && previous.dimEnabled) {
					this.#owned.add(video);
					this.#applyDim(video, true, previous.dimOpacity);
				}
				throw error;
			}
		}

		const predicted = { ...state, filter: { ...state.filter } };
		(predicted as unknown as Record<string, unknown>)[field] = value;
		const hadOwnerBaseline = this.#ownerBaselines.has(video);
		const hasActiveCssEffect = this.#hasActiveCssEffect(predicted);
		if (!hadOwnerBaseline && !hasActiveCssEffect) {
			// A neutral value on a never-owned video is a state-only no-op. Touching
			// the DOM here would both allocate the shared stylesheet unnecessarily and
			// risk deleting a page-authored attribute/custom property with the same
			// name. Existing owners continue through the normal release path below so
			// their captured baseline is restored.
			(state as unknown as Record<string, unknown>)[field] = field === 'filter'
				? { ...(value as VideoFilterState) }
				: value;
			return state[field] as ControlValues[K];
		}
		const previousState = { ...state };
		const previousDom = this.#captureDomSnapshot(video);
		const hadOwned = this.#owned.has(video);
		try {
			if (hasActiveCssEffect || hadOwnerBaseline) {
				this.#captureOwnerBaseline(video, previousDom);
			}
			if (field === 'rotation') {
				state.rotation = value as VideoEffectState['rotation'];
				video.toggleAttribute(OWNER_ATTRIBUTES[1], state.rotation !== 0);
				if (state.rotation === 0) video.style.removeProperty(OWNER_PROPERTIES[0]);
				else video.style.setProperty(OWNER_PROPERTIES[0], `${state.rotation}deg`);
				this.#updateScale(video, state);
				this.#updateRotationObservation(video, state);
			} else if (field === 'mirrored') {
				state.mirrored = value as boolean;
				this.#updateScale(video, state);
			} else if (field === 'fill') {
				state.fill = value as boolean;
				video.toggleAttribute(OWNER_ATTRIBUTES[3], state.fill);
			} else if (field === 'filterEnabled') {
				state.filterEnabled = value as boolean;
				if (state.filterEnabled) {
					this.#writeFilter(video, state);
				} else {
					video.removeAttribute(OWNER_ATTRIBUTES[4]);
					video.style.removeProperty(OWNER_PROPERTIES[3]);
					this.#filterBaselines.delete(video);
				}
			} else {
				state.filter = { ...(value as VideoFilterState) };
				this.#writeFilter(video, state);
			}
			this.#assertOwnerReadback(video, state, field);
			this.#assertComputedReadback(video, state, field);
			const actual = state[field] as ControlValues[K];
			this.#commit(video, state);
			return actual;
		} catch (error) {
			// Applying attributes/styles and then failing readback is a transaction
			// failure. Restore the exact pre-apply DOM, logical state, ownership sets,
			// and observation lease instead of leaving a half-owned video for dispose.
			this.#restoreDomSnapshot(video, previousDom);
			Object.assign(state, previousState);
			if (!hadOwnerBaseline) this.#ownerBaselines.delete(video);
			// The previous value remains in the WeakMap when an existing owner was
			// updated. A new failed owner must not retain its provisional baseline.
			if (!previousState.filterEnabled) this.#filterBaselines.delete(video);
			if (hadOwned) this.#owned.add(video);
			else this.#owned.delete(video);
			if (hadOwnerBaseline) this.#cssOwned.add(video);
			else this.#cssOwned.delete(video);
			this.#updateRotationObservation(video, previousState);
			if (this.#cssOwned.size === 0) {
				this.#styleElement?.remove();
				this.#styleElement = null;
			}
			throw error;
		}
	}

	#hasActiveCssEffect(state: VideoEffectState): boolean {
		return state.rotation !== 0
			|| state.mirrored
			|| state.fill
			|| state.filterEnabled;
	}

	#hasActiveEffect(state: VideoEffectState): boolean {
		return this.#hasActiveCssEffect(state)
			|| state.dimEnabled;
	}

	#hasConfiguredState(state: VideoEffectState): boolean {
		return this.#hasActiveEffect(state)
			|| state.dimOpacity !== DEFAULT_STATE.dimOpacity
			|| !matchesDefaultFilter(state.filter);
	}

	#commit(video: HTMLVideoElement, state: VideoEffectState): void {
		if (this.#hasActiveEffect(state)) this.#owned.add(video);
		else if (this.#hasConfiguredState(state)) this.#releaseDomOwnership(video);
		else this.release(video);
	}

	#captureDomSnapshot(video: HTMLVideoElement): VideoOwnerBaseline {
		return {
			attributes: new Map(OWNER_ATTRIBUTES.map((name) => [name, video.getAttribute(name)])),
			properties: new Map(OWNER_PROPERTIES.map((name) => [name, {
				value: video.style.getPropertyValue(name),
				priority: video.style.getPropertyPriority(name),
			}])),
		};
	}

	#restoreDomSnapshot(video: HTMLVideoElement, snapshot: VideoOwnerBaseline): void {
		for (const [attribute, value] of snapshot.attributes) {
			if (value === null) video.removeAttribute(attribute);
			else video.setAttribute(attribute, value);
		}
		for (const [property, value] of snapshot.properties) {
			if (!value.value) video.style.removeProperty(property);
			else video.style.setProperty(property, value.value, value.priority);
		}
	}

	#captureOwnerBaseline(video: HTMLVideoElement, snapshot: VideoOwnerBaseline): void {
		if (this.#ownerBaselines.has(video)) return;
		this.#ownerBaselines.set(video, snapshot);
		this.#cssOwned.add(video);
		video.setAttribute(OWNER_ATTRIBUTE, this.#ownerToken);
		this.#ensureStyle();
	}

	#assertCurrent(options: VideoEffectApplyOptions): void {
		if (this.#disposed) {
			throw new ContentLifecycleError(CANCELLED, 'Video effects controller is disposed');
		}
		if (options.signal?.aborted) throw abortError(options.signal);
		if (options.isCurrent && !options.isCurrent()) {
			throw new ContentLifecycleError(STALE_MEDIA_SOURCE, 'Video effect source is no longer current');
		}
	}

	#settleDimReadback(
		video: HTMLVideoElement,
		state: VideoEffectState,
		options: VideoEffectApplyOptions = {},
	): Promise<void> {
		if (!state.dimEnabled) {
			if (this.#dimTarget === video) {
				return Promise.reject(new Error('Dim overlay release readback failed'));
			}
			return Promise.resolve();
		}
		return new Promise((resolve, reject) => {
			let frameId = 0;
			let pending: PendingDimReadback;
			const finish = (error?: ContentLifecycleError): void => {
				if (!this.#pendingDimReadbacks.delete(pending)) return;
				clearTimeout(deadlineId);
				options.signal?.removeEventListener('abort', onAbort);
				if (frameId) {
					cancelAnimationFrame(frameId);
				}
				if (error) reject(error);
				else resolve();
			};
			const onAbort = (): void => finish(abortError(options.signal));
			const deadlineId = setTimeout(() => finish(
				new ContentLifecycleError(DEADLINE_EXCEEDED, 'Dim overlay readback deadline exceeded'),
			), Math.max(1, options.deadlineMs ?? 250));
			pending = {
				video,
				cancel: (error) => finish(error),
			};
			this.#pendingDimReadbacks.add(pending);
			options.signal?.addEventListener('abort', onAbort, { once: true });
			const readback = (): void => {
				try {
					this.#assertCurrent(options);
				} catch (error) {
					finish(error as ContentLifecycleError);
					return;
				}
				const boxes = this.#dimBoxes(video);
				if (!this.#dimHost?.isConnected
					|| this.#dimTarget !== video
					|| this.#dimRegions.length !== 4
					|| this.#dimRegions.some((region, index) => {
						const expected = boxes[index];
						if (!expected) return true;
						const actual = [
							Number.parseFloat(region.style.left),
							Number.parseFloat(region.style.top),
							Number.parseFloat(region.style.width),
							Number.parseFloat(region.style.height),
						];
						return Math.abs(Number(region.style.opacity) - state.dimOpacity) > 0.001
							|| actual.some((value, coordinate) => {
								const expectedCoordinate = expected[coordinate];
								return expectedCoordinate === undefined
									|| !Number.isFinite(value)
									|| Math.abs(value - expectedCoordinate) > 0.5;
							});
					})) {
					finish(new ContentLifecycleError(
						DEADLINE_EXCEEDED,
						'Dim overlay geometry/opacity readback failed',
					));
					return;
				}
				finish();
			};
			frameId = requestAnimationFrame(readback);
		});
	}

	#updateScale(video: HTMLVideoElement, state: VideoEffectState): void {
		const fit = this.#scaleFit(video, state);
		const ownsScale = state.mirrored || fit !== 1;
		video.toggleAttribute(OWNER_ATTRIBUTES[2], ownsScale);
		if (ownsScale) {
			video.style.setProperty(OWNER_PROPERTIES[1], String(state.mirrored ? -fit : fit));
			video.style.setProperty(OWNER_PROPERTIES[2], String(fit));
		} else {
			video.style.removeProperty(OWNER_PROPERTIES[1]);
			video.style.removeProperty(OWNER_PROPERTIES[2]);
		}
	}

	#scaleFit(video: HTMLVideoElement, state: VideoEffectState): number {
		if (state.rotation !== 90 && state.rotation !== 270) return 1;
		const width = Math.max(1, video.clientWidth);
		const height = Math.max(1, video.clientHeight);
		return Math.min(width / height, height / width);
	}

	#assertOwnerReadback(
		video: HTMLVideoElement,
		state: VideoEffectState,
		field: Extract<ControlField,
			'rotation' | 'mirrored' | 'fill' | 'filterEnabled' | 'filter'>,
	): void {
		if (field === 'rotation') {
			if (video.hasAttribute(OWNER_ATTRIBUTES[1]) !== (state.rotation !== 0)
				|| (state.rotation === 0 && video.style.getPropertyValue(OWNER_PROPERTIES[0]) !== '')) {
				throw readbackError('rotation owner');
			}
		}
		if (field === 'rotation' || field === 'mirrored') {
			const ownsScale = state.mirrored || this.#scaleFit(video, state) !== 1;
			if (video.hasAttribute(OWNER_ATTRIBUTES[2]) !== ownsScale
				|| (!ownsScale && (
					video.style.getPropertyValue(OWNER_PROPERTIES[1]) !== ''
					|| video.style.getPropertyValue(OWNER_PROPERTIES[2]) !== ''
				))) throw readbackError('scale owner');
		}
		if (field === 'fill'
			&& video.hasAttribute(OWNER_ATTRIBUTES[3]) !== state.fill) {
			throw readbackError('fill owner');
		}
		if ((field === 'filter' || field === 'filterEnabled')
			&& (video.hasAttribute(OWNER_ATTRIBUTES[4]) !== state.filterEnabled
				|| (!state.filterEnabled
					&& video.style.getPropertyValue(OWNER_PROPERTIES[3]) !== ''))) {
			throw readbackError('filter owner');
		}
	}

	#updateRotationObservation(video: HTMLVideoElement, state: VideoEffectState): void {
		const swapsAxes = state.rotation === 90 || state.rotation === 270;
		if (!swapsAxes) {
			this.#rotationObserver?.unobserve(video);
			return;
		}
		this.#rotationObserver ??= new ResizeObserver((entries) => {
			for (const entry of entries) {
				if (!(entry.target instanceof HTMLVideoElement)) continue;
				const current = this.#states.get(entry.target);
				if (current) this.#updateScale(entry.target, current);
			}
		});
		this.#rotationObserver.observe(video);
	}

	#assertComputedReadback(
		video: HTMLVideoElement,
		state: VideoEffectState,
		field: Exclude<ControlField, 'audioEnabled'>,
	): void {
		const computed = getComputedStyle(video);
		if (this.#hasActiveCssEffect(state)
			&& video.getAttribute(OWNER_ATTRIBUTE) !== this.#ownerToken) {
			throw readbackError('effect owner token');
		}
		if (field === 'fill' && state.fill && computed.objectFit !== 'cover') {
			throw readbackError('fill computed-style');
		}
		if (field === 'rotation'
			&& state.rotation !== 0
			&& this.#normalizeCss(computed.rotate) !== `${state.rotation}deg`) {
			throw readbackError('transform computed-style');
		}
		if (field === 'mirrored' && state.mirrored) {
			const expected = this.#normalizeCss(
				`${video.style.getPropertyValue(OWNER_PROPERTIES[1])} ${video.style.getPropertyValue(OWNER_PROPERTIES[2])}`,
			);
			if (this.#normalizeCss(computed.scale) !== expected) {
			throw readbackError('mirror computed-style');
			}
		}
		if ((field === 'filter' || field === 'filterEnabled')
			&& state.filterEnabled
			&& this.#normalizeCss(computed.filter) !== this.#normalizeCss(
				video.style.getPropertyValue(OWNER_PROPERTIES[3]),
			)) {
			throw readbackError('filter computed-style');
		}
	}

	#normalizeCss(value: string): string {
		return value.trim().replace(/\s+/gu, ' ');
	}

	#filterCss(filter: VideoFilterState): string {
		return `brightness(${filter.brightness}%) contrast(${filter.contrast}%) saturate(${filter.saturate}%) grayscale(${filter.grayscale ? 100 : 0}%) invert(${filter.invert ? 100 : 0}%)`;
	}

	#captureFilterBaseline(video: HTMLVideoElement): void {
		if (this.#filterBaselines.has(video)) return;
		const baseline = getComputedStyle(video).filter;
		this.#filterBaselines.set(video, baseline && baseline !== 'none' ? baseline : '');
	}

	#composedFilterCss(video: HTMLVideoElement, filter: VideoFilterState): string {
		const baseline = this.#filterBaselines.get(video) ?? '';
		return `${baseline} ${this.#filterCss(filter)}`.trim();
	}

	#writeFilter(video: HTMLVideoElement, state: VideoEffectState): void {
		if (!state.filterEnabled) return;
		this.#captureFilterBaseline(video);
		video.style.setProperty(OWNER_PROPERTIES[3], this.#composedFilterCss(video, state.filter));
		video.setAttribute(OWNER_ATTRIBUTES[4], '');
	}

	#applyDim(video: HTMLVideoElement, enabled: boolean, opacity: number): void {
		this.#dimOpacity = opacity;
		if (!enabled) {
			if (this.#dimTarget === video) this.#disposeDim();
			return;
		}
		if (this.#dimTarget && this.#dimTarget !== video) {
			const previous = this.#dimTarget;
			const previousState = this.#states.get(previous);
			if (previousState) previousState.dimEnabled = false;
			this.#disposeDim();
			if (previousState) this.#commit(previous, previousState);
		}
		if (!this.#dimHost) {
			const host = document.createElement('div');
			host.dataset.spectraOwner = 'dim-overlay';
			host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
			// Open (not closed) shadow root. A closed root buys no real security
			// benefit while making the dim overlay's DOM-bearing state unobservable
			// to tests and external tooling — the exact "untestable DOM state"
			// category called out in §4.3. feedback-surface.ts uses open for the
			// same reason; this should too.
			const root = host.attachShadow({ mode: 'open' });
			this.#dimRegions = Array.from({ length: 4 }, () => {
				const region = document.createElement('div');
				region.style.cssText = `position:fixed;background:${UI_COLORS.OVERLAY_DIM};pointer-events:none;`;
				root.appendChild(region);
				return region;
			});
			this.#overlayRoot(video).appendChild(host);
			this.#dimHost = host;
			for (const event of DIM_EVENTS) {
				window.addEventListener(event, this.#scheduleDim, true);
				window.visualViewport?.addEventListener(event, this.#scheduleDim);
			}
			document.addEventListener('fullscreenchange', this.#scheduleDim, true);
			this.#resizeObserver = new ResizeObserver(this.#scheduleDim);
		}
		if (this.#dimTarget !== video) {
			this.#resizeObserver?.disconnect();
			this.#dimTarget = video;
			this.#resizeObserver?.observe(video);
		}
		this.#scheduleDim();
	}

	readonly #scheduleDim = (): void => {
		if (this.#disposed || this.#frameId) return;
		this.#frameId = requestAnimationFrame(() => {
			this.#frameId = 0;
			const video = this.#dimTarget;
			if (!video || !this.#dimHost) return;
			const root = this.#overlayRoot(video);
			if (this.#dimHost.parentElement !== root) root.appendChild(this.#dimHost);
			const boxes = this.#dimBoxes(video);
			for (let index = 0; index < boxes.length; index++) {
				const box = boxes[index];
				const region = this.#dimRegions[index];
				if (!box || !region) {
					this.#disposeDim();
					return;
				}
				const [x, y, w, h] = box;
				region.style.left = `${x}px`;
				region.style.top = `${y}px`;
				region.style.width = `${w}px`;
				region.style.height = `${h}px`;
				region.style.opacity = String(this.#dimOpacity);
			}
		});
	};

	#overlayRoot(video: HTMLVideoElement): HTMLElement {
		const fullscreen = document.fullscreenElement;
		return fullscreen instanceof HTMLElement && fullscreen.contains(video)
			? fullscreen
			: document.documentElement;
	}

	#cancelPending(
		video: HTMLVideoElement | null,
		code: 'cancelled' | 'stale-media-source',
		message: string,
	): void {
		for (const pending of [...this.#pendingDimReadbacks]) {
			if (!video || pending.video === video) {
				pending.cancel(new ContentLifecycleError(code, message));
			}
		}
	}

	#disposeDim(): void {
		this.#cancelPending(null, CANCELLED, 'Dim overlay was disposed');
		if (this.#frameId) cancelAnimationFrame(this.#frameId);
		this.#frameId = 0;
		this.#resizeObserver?.disconnect();
		this.#resizeObserver = null;
		for (const event of DIM_EVENTS) {
			window.removeEventListener(event, this.#scheduleDim, true);
			window.visualViewport?.removeEventListener(event, this.#scheduleDim);
		}
		document.removeEventListener('fullscreenchange', this.#scheduleDim, true);
		this.#dimHost?.remove();
		this.#dimHost = null;
		this.#dimRegions = [];
		this.#dimTarget = null;
	}

	#releaseDomOwnership(video: HTMLVideoElement): void {
		this.#rotationObserver?.unobserve(video);
		const baseline = this.#ownerBaselines.get(video);
		if (baseline) this.#restoreDomSnapshot(video, baseline);
		this.#ownerBaselines.delete(video);
		this.#cssOwned.delete(video);
		this.#filterBaselines.delete(video);
		this.#owned.delete(video);
		if (this.#cssOwned.size === 0) {
			this.#styleElement?.remove();
			this.#styleElement = null;
		}
	}

	#clearRetiredDom(video: HTMLVideoElement, state: VideoEffectState): void {
		const fit = this.#scaleFit(video, state), ownsScale = state.mirrored || fit !== 1;
		if (video.getAttribute(OWNER_ATTRIBUTE) === this.#ownerToken) video.removeAttribute(OWNER_ATTRIBUTE);
		const attrs = [state.rotation !== 0, ownsScale, state.fill, state.filterEnabled];
		const values = [
			state.rotation ? `${state.rotation}deg` : '',
			ownsScale ? String(state.mirrored ? -fit : fit) : '',
			ownsScale ? String(fit) : '',
			state.filterEnabled ? this.#composedFilterCss(video, state.filter) : '',
		];
		for (let index = 0; index < 4; index++) {
		// biome-ignore lint/style/noNonNullAssertion: the fixed loop covers every owner attribute slot
			const attribute = OWNER_ATTRIBUTES[index + 1]!;
			if (attrs[index] && video.hasAttribute(attribute)) {
				video.removeAttribute(attribute);
			}
			// biome-ignore lint/style/noNonNullAssertion: the fixed loop covers every owner property slot
			const property = OWNER_PROPERTIES[index]!;
			if (video.style.getPropertyValue(property) === values[index]) {
				video.style.removeProperty(property);
			}
		}
	}

	/**
	 * Retire a source while the element is being reused by the page. Unlike a
	 * user-requested neutral release, this must not restore a baseline captured
	 * for the previous source over page-authored values for the next source.
	 */
	retireSource(video: HTMLVideoElement): VideoEffectState {
		this.#cancelPending(video, STALE_MEDIA_SOURCE, 'Video effect source was retired');
		if (this.#dimTarget === video) this.#disposeDim();
		const state = this.#states.get(video);
		if (state) this.#clearRetiredDom(video, state);
		this.#ownerBaselines.delete(video);
		this.#releaseDomOwnership(video);
		this.#states.delete(video);
		return defaultState();
	}

	release(video: HTMLVideoElement): VideoEffectState {
		this.#cancelPending(video, STALE_MEDIA_SOURCE, 'Video effect source was released');
		this.#releaseDomOwnership(video);
		this.#states.delete(video);
		return defaultState();
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#disposeDim();
		this.#rotationObserver?.disconnect();
		this.#rotationObserver = null;
		for (const video of [...this.#owned]) this.release(video);
		this.#owned.clear();
		this.#cssOwned.clear();
		this.#styleElement?.remove();
		this.#styleElement = null;
	}
}
