// goal: event-driven media identity and sticky active-target selection without command-time scans

import type { MediaTarget } from '@nexus/contracts';
import type { MediaSourceEligibilityEvidence } from '@nexus/audio-engine';
import type { DocumentRuntimeContext } from './content-runtime-context';
import { claimMediaObservationEpoch } from '../../shared/content-runtime';
import { isLiveMedia } from '../../shared/media-live';

export type MediaRegistryEvent =
	| 'registered'
	| 'removed'
	| 'selected'
	| 'loadstart'
	| 'play'
	| 'pause'
	| 'ended'
	| 'loadedmetadata'
	| 'loadeddata'
	| 'durationchange'
	| 'emptied'
	| 'volumechange'
	| 'ratechange'
	| 'loopchange'
	| 'seeked'
	| 'enterpictureinpicture'
	| 'leavepictureinpicture'
	| 'fullscreenchange';

export type MediaRegistryRemovalReason = 'detached' | 'source-change';

interface MediaRecord {
	element: HTMLMediaElement;
	target: MediaTarget;
	source: string;
	sourceTransitionOpen: boolean;
	eligibilityEvidence?: MediaSourceEligibilityEvidence;
	registrationOrder: number;
	lastInteraction: number;
	lastPlay: number;
	visibleArea: number;
	presentationHidden: boolean;
	dispose(): void;
}

type MediaRegistryListener = (
	record: MediaTarget,
	event: MediaRegistryEvent,
	element: HTMLMediaElement,
	removalReason?: MediaRegistryRemovalReason,
) => void;

const sourceObjectIds = new WeakMap<object, number>();
let nextSourceObjectId = 1;

function sourceIdentity(element: HTMLMediaElement): string {
	const sourceObject = element.srcObject;
	let objectIdentity = 0;
	if (sourceObject && typeof sourceObject === 'object') {
		const existing = sourceObjectIds.get(sourceObject);
		if (existing === undefined) {
			objectIdentity = nextSourceObjectId++;
			sourceObjectIds.set(sourceObject, objectIdentity);
		} else {
			objectIdentity = existing;
		}
	}
	return `${element.currentSrc || element.src || ''}\n${objectIdentity}`;
}

function preloadCorsEvidence(
	element: HTMLMediaElement,
): MediaSourceEligibilityEvidence | undefined {
	const resourceUrl = element.currentSrc || element.src || '';
	if (!resourceUrl || element.readyState < HTMLMediaElement.HAVE_METADATA || element.error) return undefined;
	const crossOrigin = element.crossOrigin;
	if (crossOrigin !== 'anonymous' && crossOrigin !== 'use-credentials') return undefined;
	return { kind: 'preload-cors', resourceUrl };
}

function initialVisibleArea(element: HTMLMediaElement): number {
	const rect = element.getBoundingClientRect();
	if (rect.width <= 0 || rect.height <= 0) return 0;
	if (typeof window === 'undefined') return rect.width * rect.height;
	const left = Math.max(0, rect.left);
	const top = Math.max(0, rect.top);
	const right = Math.min(window.innerWidth, rect.right);
	const bottom = Math.min(window.innerHeight, rect.bottom);
	return Math.max(0, right - left) * Math.max(0, bottom - top);
}

/** Lexicographic comparison of two ranking tuples: first difference decides. */
function outranks(left: readonly number[], right: readonly number[]): boolean {
	for (let index = 0; index < left.length; index += 1) {
		const leftValue = left[index] ?? 0;
		const rightValue = right[index] ?? 0;
		if (leftValue !== rightValue) return leftValue > rightValue;
	}
	return false;
}

/**
 * An available live broadcast remains the control target beside a finite
 * pre-roll, even when the ad is larger or the page initially muted the stream.
 * Playback is not a prerequisite: startup/pre-roll can park the broadcast at
 * paused after its stream is known, and volume must already belong to it.
 * A hidden live preview has no presentation evidence and cannot take the visit.
 * Explicit selection, playback pins and browser presentation retain their guards.
 */
function mediaRank(
	element: HTMLMediaElement,
	visibleArea: number,
): [number, number, number] {
	return [
		visibleArea > 0 && !element.ended && isLiveMedia(element) ? 1 : 0,
		!element.paused && !element.ended ? 1 : 0,
		visibleArea,
	];
}

/** One stateless admission for cold bootstrap and a registry with no selection.
 * Supplying retained geometry keeps registry reads free of layout sampling. */
export function chooseInitialMedia(
	elements: readonly HTMLMediaElement[],
	kind: 'media' | 'video' = 'media',
	visibleArea: (element: HTMLMediaElement) => number = initialVisibleArea,
): HTMLMediaElement | null {
	const candidates = elements.filter((element) => element.isConnected
		&& (kind === 'media' || element instanceof HTMLVideoElement));
	const pip = document.pictureInPictureElement;
	const exactPip = candidates.find((element) => element === pip);
	if (exactPip) return exactPip;
	const fullscreen = document.fullscreenElement;
	const presented = fullscreen ? candidates.filter((element) => fullscreen === element
		|| fullscreen instanceof Element && fullscreen.contains(element)) : [];
	const pool = presented.length > 0 ? presented : candidates;
	let best: HTMLMediaElement | null = null;
	let bestRank: [number, number, number] = [-1, -1, -1];
	for (const candidate of pool) {
		const rank = mediaRank(candidate, visibleArea(candidate));
		if (!best || outranks(rank, bestRank)) {
			best = candidate; bestRank = rank;
		}
	}
	return best;
}

let activeMediaRegistry: MediaRegistry | null = null;

export function setActiveMediaRegistry(registry: MediaRegistry | null): () => void {
	activeMediaRegistry = registry;
	return () => {
		if (activeMediaRegistry === registry) activeMediaRegistry = null;
	};
}

export function getActiveMediaRegistry(): MediaRegistry | null {
	return activeMediaRegistry;
}

export class MediaRegistry {
	readonly runtimeContext: DocumentRuntimeContext;
	private readonly byElement = new Map<HTMLMediaElement, MediaRecord>();
	private readonly byId = new Map<string, MediaRecord>();
	private readonly mutationObserver: MutationObserver;
	private readonly mediaAttributeObserver: MutationObserver;
	private readonly intersectionObserver: IntersectionObserver;
	private nextMediaId = 1;
	private order = 1;
	private activeMediaId: string | null = null;
	private activeVideoId: string | null = null;
	private fullscreenMediaId: string | null = null;
	private selectedTargetKey: string | null = null;
	private pausedSelectionKey: string | null = null;
	private explicitSelectionKey: string | null = null;
	private selectionVisit = 0;
	private observationRevision = 0;
	private readonly observationOwner: string;
	private readonly observationEpoch: number;
	private readonly pendingRemovals = new Set<HTMLMediaElement>();
	private removalFlushQueued = false;
	private disposed = false;
	private readonly fullscreenListener: EventListener;
	private readonly listeners = new Set<MediaRegistryListener>();

	constructor(runtimeContext: DocumentRuntimeContext, onEvent?: MediaRegistryListener) {
		this.runtimeContext = runtimeContext;
		this.runtimeContext.assertOpen();
		const ownerEpoch = claimMediaObservationEpoch(runtimeContext.runtimeEpoch);
		this.observationOwner = `${runtimeContext.identity.documentId}:${ownerEpoch}`;
		this.observationEpoch = ownerEpoch;
		if (onEvent) this.listeners.add(onEvent);
		this.fullscreenListener = () => {
			const fullscreenElement = document.fullscreenElement;
			const entering = fullscreenElement
				? this.fullscreenRecord(fullscreenElement)
				: null;
			const record = entering
				?? (this.fullscreenMediaId ? this.byId.get(this.fullscreenMediaId) : undefined);
			if (!record) return;
			if (entering) {
				this.selectRecord(record, false);
				this.fullscreenMediaId = record.target.mediaId;
			} else this.fullscreenMediaId = null;
			if (!entering) this.reconcileRetiredSelection();
			this.emit(record.target, 'fullscreenchange', record.element);
		};
		this.intersectionObserver = new IntersectionObserver((entries) => {
			let returning: MediaRecord | null = null;
			for (const entry of entries) {
				const media = entry.target;
				if (!(media instanceof HTMLMediaElement)) continue;
				const record = this.byElement.get(media);
				if (!record) continue;
				const wasHidden = record.presentationHidden;
				// A non-intersecting player may simply have scrolled off screen.
				// Only losing its layout box proves a hidden presentation whose
				// return can start a new visit and replay retained media settings.
				record.presentationHidden = entry.boundingClientRect.width <= 0 || entry.boundingClientRect.height <= 0;
				record.visibleArea = entry.isIntersecting
					? entry.intersectionRect.width * entry.intersectionRect.height
					: 0;
				if (wasHidden && record.visibleArea > 0 && this.activeMediaId === record.target.mediaId) returning = record;
			}
			this.reconcileRetiredSelection();
			// Geometry is the last fact to arrive. An element registered while it
			// was still unlaid-out had no area to be admitted on, and the reconcile
			// above keeps an already-playing visible owner, so the admission has to
			// be retried here once the measurement exists.
			this.admitBetterCandidate(true);
			if (returning && this.activeMediaId === returning.target.mediaId) {
				this.selectedTargetKey = null;
				this.selectRecord(returning, true);
			}
		});
		this.mediaAttributeObserver = new MutationObserver((mutations) => {
			this.handleMediaAttributeMutations(mutations);
		});

		// Register the initial media set before installing the topology observer.
		// Construction is synchronous, so there is no observable DOM gap.
		this.discover(document.documentElement);
		this.establishInitialSelection(false);

		// The document-wide observer owns topology only. Attributes are observed
		// through one shared observer attached directly to registered media nodes,
		// so image/input/source churn elsewhere in a large SPA never enters SPECTRA.
		this.mutationObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				// Real topology observation never receives attributes. Keeping this
				// defensive branch makes synthetic test observers and future callers
				// harmless without widening the browser observation options.
				if (mutation.type === 'attributes') {
					this.handleMediaAttributeMutations([mutation]);
					continue;
				}
				for (const node of mutation.addedNodes) this.discover(node);
				for (const node of mutation.removedNodes) this.queueRemovalTree(node);
			}
			this.establishInitialSelection(true);
		});
		this.mutationObserver.observe(document, {
			childList: true,
			subtree: true,
		});
		document.addEventListener('fullscreenchange', this.fullscreenListener);
	}

	get documentId(): string {
		return this.runtimeContext.identity.documentId;
	}

	get selectionRevision(): number { return this.selectionVisit; }

	captureObservation(): { owner: string; epoch: number; selection: number; revision: number } {
		return { owner: this.observationOwner, epoch: this.observationEpoch, selection: this.selectionVisit,
			revision: ++this.observationRevision };
	}

	subscribe(listener: MediaRegistryListener): () => void {
		if (this.disposed) throw new Error('Media registry is disposed');
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(
		target: MediaTarget,
		event: MediaRegistryEvent,
		element: HTMLMediaElement,
		removalReason?: MediaRegistryRemovalReason,
	): void {
		for (const listener of this.listeners) {
			listener({ ...target }, event, element, removalReason);
		}
	}

	private discover(node: Node): void {
		if (node instanceof HTMLMediaElement) this.register(node);
		if (!(node instanceof Element)) return;
		for (const media of node.querySelectorAll('video,audio')) {
			if (media instanceof HTMLMediaElement) this.register(media);
		}
	}

	private queueRemovalTree(node: Node): void {
		if (node instanceof HTMLMediaElement) this.pendingRemovals.add(node);
		if (!(node instanceof Element)) return;
		for (const media of node.querySelectorAll('video,audio')) {
			if (media instanceof HTMLMediaElement) this.pendingRemovals.add(media);
		}
		if (this.removalFlushQueued) return;
		this.removalFlushQueued = true;
		queueMicrotask(() => {
			this.removalFlushQueued = false;
			const previous = this.best('media');
			for (const media of this.pendingRemovals) {
				if (!media.isConnected) this.unregister(media);
			}
			this.pendingRemovals.clear();
			this.reconcileRetiredSelection(!!previous && !this.byElement.has(previous.element));
		});
	}

	private handleMediaAttributeMutations(mutations: readonly MutationRecord[]): void {
		if (this.disposed) return;
		for (const mutation of mutations) {
			const element = mutation.target;
			if (!(element instanceof HTMLMediaElement)) continue;
			const record = this.byElement.get(element);
			if (!record) continue;
			if (mutation.attributeName === 'src') this.refreshSource(element, false);
			if (mutation.attributeName === 'loop') {
				this.emit(record.target, 'loopchange', element);
			}
		}
	}

	private observeMediaAttributes(element: HTMLMediaElement): void {
		this.mediaAttributeObserver.observe(element, {
			attributes: true,
			attributeFilter: ['src', 'loop'],
		});
	}

	private rebuildMediaAttributeObservation(): void {
		// MutationObserver has no per-target unobserve(). Before reconnecting the
		// remaining media set, preserve already-queued records for surviving nodes.
		const maybeTakeRecords = (this.mediaAttributeObserver as Partial<MutationObserver>).takeRecords;
		if (typeof maybeTakeRecords === 'function') {
			this.handleMediaAttributeMutations(maybeTakeRecords.call(this.mediaAttributeObserver));
		}
		this.mediaAttributeObserver.disconnect();
		for (const { element } of this.byElement.values()) this.observeMediaAttributes(element);
	}

	private register(element: HTMLMediaElement): void {
		if (this.disposed || this.byElement.has(element)) return;
		// A released runtime can be rebuilt in the same document with a different
		// DOM order. IDs from the retired registry must never alias new elements.
		const mediaId = `media:${this.observationEpoch}:${this.nextMediaId++}`;
		const record: MediaRecord = {
			element,
			target: {
				frameId: this.runtimeContext.identity.frameId,
				documentId: this.documentId,
				mediaId,
				sourceRevision: 0,
				kind: element instanceof HTMLVideoElement ? 'video' : 'audio',
			},
			source: sourceIdentity(element),
			sourceTransitionOpen: false,
			eligibilityEvidence: preloadCorsEvidence(element),
			registrationOrder: this.order++,
			lastInteraction: 0,
			lastPlay: 0,
			// IntersectionObserver is asynchronous. Seed the first selection from
			// current geometry so a restore that immediately follows runtime
			// acquisition cannot choose an earlier hidden/preloaded SPA source
			// before the observer delivers its initial entries.
			visibleArea: initialVisibleArea(element),
			presentationHidden: false,
			dispose: () => undefined,
		};
		const listeners: Array<[MediaRegistryEvent, EventListener]> = [];
		for (const type of [
			'loadstart',
			'play',
			'pause',
			'ended',
			'loadedmetadata',
			'loadeddata',
			'durationchange',
			'emptied',
			'volumechange',
			'ratechange',
			'seeked',
			'enterpictureinpicture',
			'leavepictureinpicture',
		] as const) {
			const listener = (): void => {
				if (type === 'play') {
					if (this.pausedSelectionKey === this.targetKey(record.target)) this.pausedSelectionKey = null;
					record.lastPlay = performance.now();
					// A pre-rendered modal can become visible and start before the
					// asynchronous IntersectionObserver delivers its new geometry.
					record.visibleArea = initialVisibleArea(element);
					const active = this.activeMediaId ? this.byId.get(this.activeMediaId) : undefined;
					if (active && active !== record) active.visibleArea = initialVisibleArea(active.element);
					const candidate = this.bestRecord([...this.byElement.values()].filter(candidate => (
						!active || !this.isSelectionProtected(active, candidate)
					)));
					if (candidate) this.selectRecord(candidate, true);
				}
				if (type === 'pause' || type === 'ended' || type === 'leavepictureinpicture') {
					record.visibleArea = initialVisibleArea(element);
					this.reconcileRetiredSelection();
				}
				if (type === 'loadstart' || type === 'emptied') this.refreshSource(element, true);
				if (type === 'loadedmetadata') {
					this.refreshSource(element, false);
					record.sourceTransitionOpen = false;
					record.eligibilityEvidence = preloadCorsEvidence(element);
				}
				if (type === 'loadedmetadata' || type === 'loadeddata' || type === 'durationchange') {
					// MSE may publish its unbounded timeline before the first data.
					// Admit the live presentation when either piece of evidence arrives.
					this.admitBetterCandidate(true);
				}
				// A script-written media property also produces a trusted browser
				// event. It is observation, not evidence of user target selection;
				// inactive previews must not steal the volume/speed control owner.
				this.emit(record.target, type, element);
			};
			element.addEventListener(type, listener);
			listeners.push([type, listener]);
		}
		const onPointer = (event: Event): void => {
			if (!event.isTrusted) return;
			record.lastInteraction = performance.now();
			this.selectRecord(record, true);
		};
		element.addEventListener('pointerdown', onPointer, true);

		record.dispose = () => {
			for (const [type, listener] of listeners) element.removeEventListener(type, listener);
			element.removeEventListener('pointerdown', onPointer, true);
		};
		this.byElement.set(element, record);
		this.byId.set(mediaId, record);
		this.observeMediaAttributes(element);
		this.intersectionObserver.observe(element);
		this.emit(record.target, 'registered', element);
	}

	private unregister(element: HTMLMediaElement): void {
		const record = this.byElement.get(element);
		if (!record) return;
		this.emit(record.target, 'removed', element, 'detached');
		record.dispose();
		this.intersectionObserver.unobserve(element);
		this.byElement.delete(element);
		this.byId.delete(record.target.mediaId);
		if (this.activeMediaId === record.target.mediaId) this.activeMediaId = null;
		if (this.activeVideoId === record.target.mediaId) this.activeVideoId = null;
		if (this.fullscreenMediaId === record.target.mediaId) this.fullscreenMediaId = null;
		if (this.selectedTargetKey === this.targetKey(record.target)) this.selectedTargetKey = null;
		this.rebuildMediaAttributeObservation();
	}

	private refreshSource(
		element: HTMLMediaElement,
		lifecycleBoundary: boolean,
	): void {
		const record = this.byElement.get(element);
		if (!record) return;
		const source = sourceIdentity(element);
		record.eligibilityEvidence = preloadCorsEvidence(element);
		if (lifecycleBoundary && record.sourceTransitionOpen) {
			// Still inside the transition this flag opened: adopt the source without
			// re-registering. A *different* source means that transition never
			// reached `loadedmetadata` (a failed load), and keeping the flag open
			// would swallow every later boundary refresh — the new identity would
			// never emit `registered` and would have no control owner (SP-54).
			if (source === record.source) return;
			record.sourceTransitionOpen = false;
		}
		if (!lifecycleBoundary && source === record.source) return;
		// A reused <audio>/<video> element is a new control identity. Emit a
		// logical removal before incrementing the revision so every source-scoped
		// owner can dispose baselines, CSS/overlay state and graph routing without
		// polling or command-time scans, then re-register the same element under
		// its new identity.
		this.emit(record.target, 'removed', element, 'source-change');
		record.source = source;
		record.sourceTransitionOpen = true;
		record.eligibilityEvidence = undefined;
		record.target.sourceRevision += 1;
		this.emit(record.target, 'registered', element);
		if (this.activeMediaId === record.target.mediaId) this.selectRecord(record, true);
	}

	private targetKey(target: MediaTarget): string {
		return `${target.documentId}:${target.frameId}:${target.mediaId}:${target.sourceRevision}`;
	}

	private selectRecord(record: MediaRecord, notify: boolean): void {
		if (this.activeMediaId !== record.target.mediaId) {
			this.pausedSelectionKey = null;
			this.explicitSelectionKey = null;
		}
		this.activeMediaId = record.target.mediaId;
		if (record.target.kind === 'video') this.activeVideoId = record.target.mediaId;
		const key = this.targetKey(record.target);
		if (key === this.selectedTargetKey) return;
		this.selectedTargetKey = key;
		this.selectionVisit += 1;
		if (notify) this.emit(record.target, 'selected', record.element);
	}

	private establishInitialSelection(notify: boolean): void {
		// Commit the complete discovery batch before a command can capture its
		// visit. The first own play is not a new selection of the same element.
		// This is automatic admission, never an explicit or paused-target pin.
		if (this.activeMediaId === null) {
			const initial = this.best('media');
			if (initial) this.selectRecord(initial, notify);
		} else this.admitBetterCandidate(notify);
		// Audio may own activeMedia while an independent video remains the video
		// scope. Establishing that scope must not replace the media selection.
		if (this.activeVideoId === null) {
			const initialVideo = this.best('video');
			if (initialVideo) this.activeVideoId = initialVideo.target.mediaId;
		}
	}

	/**
	 * Admission for a playing candidate or a visible, confirmed live stream.
	 *
	 * A pre-playing element need not fire `play` again; a parked broadcast must
	 * not wait for playback to take volume ownership. Geometry is also required:
	 * once the element is laid out and genuinely outranks the current owner, it
	 * is the better presentation.
	 *
	 * Only an automatic selection can be replaced. A pick the viewer made, a
	 * paused-target pin and anything the browser is presenting all outrank it.
	 */
	private isSelectionProtected(active: MediaRecord, candidate: MediaRecord): boolean {
		if (this.explicitSelectionKey === this.targetKey(active.target)
			|| this.pausedSelectionKey === this.targetKey(active.target)) return true;
		const presented = document.fullscreenElement;
		return document.pictureInPictureElement === active.element
			|| presented === active.element
			// A fullscreen player container can contain both a pre-roll and the
			// broadcast. Protect its scope without pinning the pre-roll inside it.
			|| presented instanceof Element && presented.contains(active.element) && !presented.contains(candidate.element);
	}

	private admitBetterCandidate(notify: boolean): void {
		const active = this.activeMediaId ? this.byId.get(this.activeMediaId) : undefined;
		if (!active) return;
		const challenger = this.bestRecord([...this.byElement.values()].filter((record) => (
			record !== active && !this.isSelectionProtected(active, record) && !record.element.ended
			&& (!record.element.paused || isLiveMedia(record.element))
			// A hidden or unlaid-out preview is not a presentation. Geometry is
			// what proves the viewer can actually see this element; a live
			// timeline does not.
			&& record.visibleArea > 0
		)));
		if (!challenger || this.compare(challenger, active) <= 0) return;
		this.selectRecord(challenger, notify);
	}

	private reconcileRetiredSelection(replacingRemovedTarget = false): void {
		if (this.disposed) return;
		const active = this.activeMediaId ? this.byId.get(this.activeMediaId) : undefined;
		// Initial visibility delivery is not a selection change. Publishing it
		// during a cold restore would relabel acknowledged portable intent as a
		// page observation before the restore has finished committing.
		if (!active && !replacingRemovedTarget) return;
		if (active) {
			// Hiding a modal is not a source retirement. Reconcile the selection
			// from lifecycle events, so an already-playing feed need not play again.
			// Visible paused players and actual presentation owners stay controllable.
			if (active.target.kind === 'audio') return;
			const fullscreen = document.fullscreenElement;
			if (document.pictureInPictureElement === active.element
				|| fullscreen === active.element
				|| fullscreen instanceof Element && fullscreen.contains(active.element)) return;
			if (!active.element.ended && active.visibleArea > 0) {
				if (!active.element.paused || this.pausedSelectionKey === this.targetKey(active.target)
					|| this.explicitSelectionKey === this.targetKey(active.target)) return;
				// A later foreground player may start before this feed pauses. Its
				// first play lost to historical pointer evidence; the later pause is
				// the handoff boundary. An older/tiny preview cannot take this path.
				const successor = this.bestRecord([...this.byElement.values()].filter((record) => (
					record !== active && record.target.kind === 'video' && !record.element.paused
					&& !record.element.ended && record.lastPlay > active.lastPlay
					&& record.visibleArea >= active.visibleArea
				)));
				if (successor && this.compare(successor, active) > 0) this.selectRecord(successor, true);
				return;
			}
		}
		const candidates = [...this.byElement.values()].filter((record) => (
			!record.element.ended && (record.target.kind === 'audio'
				? !record.element.paused
				: record.visibleArea > 0)
		));
		const candidate = this.bestRecord(candidates);
		if (candidate && candidate !== active) this.selectRecord(candidate, true);
	}

	select(target: MediaTarget): boolean {
		const record = this.recordForTarget(target);
		if (!record) return false;
		this.selectRecord(record, true);
		this.explicitSelectionKey = this.targetKey(record.target);
		return true;
	}

	/** Explicit pause/selection ownership differs from a historical pointer. */
	pinPaused(target: MediaTarget): void {
		if (this.recordForTarget(target)) this.pausedSelectionKey = this.targetKey(target);
	}

	private recordForTarget(target: MediaTarget): MediaRecord | null {
		const record = this.byId.get(target.mediaId);
		return record
			&& record.target.documentId === target.documentId
			&& record.target.frameId === target.frameId
			&& record.target.sourceRevision === target.sourceRevision
			? record
			: null;
	}

	private bestRecord(
		records: Iterable<MediaRecord>,
		kind: 'media' | 'video' = 'media',
	): MediaRecord | null {
		let best: MediaRecord | null = null;
		for (const record of records) {
			if (kind === 'video' && record.target.kind !== 'video') continue;
			if (!best || this.compare(record, best) > 0) best = record;
		}
		return best;
	}

	private fullscreenRecord(owner: Element): MediaRecord | null {
		if (owner instanceof HTMLMediaElement) {
			const exact = this.byElement.get(owner);
			if (exact) return exact;
		}
		const contained = [...this.byElement.values()].filter(({ element }) => owner.contains(element));
		if (contained.length === 0) return null;
		const activeVideo = this.activeVideoId ? this.byId.get(this.activeVideoId) : undefined;
		if (activeVideo && contained.includes(activeVideo)) return activeVideo;
		const bestVideo = this.bestRecord(contained, 'video');
		if (bestVideo) return bestVideo;
		const activeMedia = this.activeMediaId ? this.byId.get(this.activeMediaId) : undefined;
		if (activeMedia && contained.includes(activeMedia)) return activeMedia;
		return this.bestRecord(contained);
	}

	private best(kind: 'media' | 'video'): MediaRecord | null {
		const activeId = kind === 'video' ? this.activeVideoId : this.activeMediaId;
		const active = activeId ? this.byId.get(activeId) : undefined;
		if (active && (kind === 'media' || active.target.kind === 'video')) return active;
		const initial = chooseInitialMedia([...this.byElement.keys()], kind,
			(element) => this.byElement.get(element)?.visibleArea ?? 0);
		return initial ? this.byElement.get(initial) ?? null : null;
	}

	peek(
		target: MediaTarget | null,
		kind: 'media' | 'video' = 'media',
	): { element: HTMLMediaElement; target: MediaTarget } | null {
		if (target) {
			const record = this.recordForTarget(target);
			if (!record || kind === 'video' && record.target.kind !== 'video') return null;
			return { element: record.element, target: { ...record.target } };
		}
		const best = this.best(kind);
		if (!best) return null;
		return { element: best.element, target: { ...best.target } };
	}

	resolve(target: MediaTarget | null): { element: HTMLMediaElement; target: MediaTarget } | null {
		return this.peek(target, 'media');
	}

	resolveVideo(target: MediaTarget | null): { element: HTMLVideoElement; target: MediaTarget } | null {
		const resolved = this.peek(target, 'video');
		return resolved && resolved.element instanceof HTMLVideoElement
			? { element: resolved.element, target: resolved.target }
			: null;
	}

	list(): Array<{ element: HTMLMediaElement; target: MediaTarget }> {
		return [...this.byElement.values()].map((record) => ({
			element: record.element,
			target: { ...record.target },
		}));
	}

	listProcessingSources(): Array<{ element: HTMLMediaElement; target: MediaTarget }> {
		return this.list().filter(({ element }) => (
			Boolean(element.currentSrc || element.src) || element.srcObject != null
		));
	}

	get size(): number {
		return this.byElement.size;
	}

	hasPlayingMedia(): boolean {
		for (const { element } of this.byElement.values()) {
			if (!element.paused && !element.ended) return true;
		}
		return false;
	}

	getEligibilityEvidence(
		element: HTMLMediaElement,
	): MediaSourceEligibilityEvidence | undefined {
		const evidence = this.byElement.get(element)?.eligibilityEvidence;
		return evidence ? { ...evidence } : undefined;
	}

	private compare(left: MediaRecord, right: MediaRecord): number {
		// A past click cannot pin a paused/retired/hidden feed above a newly opened
		// modal. Audio-only media is intentionally independent of geometry.
		const interaction = (record: MediaRecord): number => record.element.ended
			|| record.target.kind === 'video' && (record.element.paused || record.visibleArea <= 0)
			? 0 : record.lastInteraction;
		const interactionDifference = interaction(left) - interaction(right);
		if (interactionDifference !== 0) return interactionDifference;
		// Same tuple the cold admission uses, so a reconcile cannot land on a
		// different target than the bootstrap that preceded it.
		const leftRank = mediaRank(left.element, left.visibleArea);
		const rightRank = mediaRank(right.element, right.visibleArea);
		for (let index = 0; index < leftRank.length; index += 1) {
			const leftValue = leftRank[index] ?? 0;
			const rightValue = rightRank[index] ?? 0;
			if (leftValue !== rightValue) return leftValue - rightValue;
		}
		if (left.lastPlay !== right.lastPlay) return left.lastPlay - right.lastPlay;
		return right.registrationOrder - left.registrationOrder;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.mutationObserver.disconnect();
		this.mediaAttributeObserver.disconnect();
		this.intersectionObserver.disconnect();
		document.removeEventListener('fullscreenchange', this.fullscreenListener);
		for (const record of this.byElement.values()) record.dispose();
		this.byElement.clear();
		this.byId.clear();
		this.pendingRemovals.clear();
		this.listeners.clear();
		this.activeMediaId = null;
		this.activeVideoId = null;
		this.fullscreenMediaId = null;
		this.selectedTargetKey = null;
	}
}
