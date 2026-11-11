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
	private selectedIdentityKey: string | null = null;
	private pausedSelectionKey: string | null = null;
	private explicitSelectionKey: string | null = null;
	private selectionVisit = 0;
	private observationRevision = 0;
	private observationOwner: string;
	private observationEpoch: number;
	private readonly pendingRemovals = new Set<HTMLMediaElement>();
	// Control identities that left the document while a viewer still owned them.
	// An SPA that swaps players keeps issuing intents against the element it had
	// selected; resolving those to the successor is what makes the first gesture
	// after a replacement work instead of failing `stale-media-source`
	// (SP-22.3 §2).
	private readonly retiredControlIds = new Map<string, 'video' | 'audio'>();
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
				this.selectedIdentityKey = null;
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

	/** The runtime has a concrete media element, so it can own native observation. */
	get hasSelection(): boolean { return this.activeMediaId !== null; }

	/**
	 * True when the viewer pinned the current selection by choosing or pausing
	 * that element. Automatic admission (SPA swap, geometry, live handover) never
	 * pins, so an in-flight `active-target` write may follow it; an explicit
	 * choice must not be overwritten by a gesture the viewer made elsewhere.
	 */
	get selectionPinnedByViewer(): boolean {
		const active = this.activeMediaId ? this.byId.get(this.activeMediaId) : undefined;
		if (!active) return false;
		const key = this.targetKey(active.target);
		return this.explicitSelectionKey === key || this.pausedSelectionKey === key;
	}

	/**
	 * Take observation ownership for this registry instance. Construction already
	 * claims an epoch; this is the explicit handoff when a ready runtime starts
	 * observing media, so its samples supersede the bootstrap's and every
	 * replacement registry stays stale.
	 */
	claimObservationOwnership(): void {
		const epoch = claimMediaObservationEpoch();
		this.observationEpoch = epoch;
		this.observationOwner = `${this.runtimeContext.identity.documentId}:${epoch}`;
		this.observationRevision = 0;
	}

	captureObservation(): { owner: string; epoch: number; selection: number; revision: number } {
		return { owner: this.observationOwner, epoch: this.observationEpoch,
			selection: this.selectionVisit, revision: ++this.observationRevision };
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
			for (const media of this.pendingRemovals) {
				if (!media.isConnected) this.unregister(media);
			}
			this.pendingRemovals.clear();
			this.reconcileRetiredSelection();
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
		// A player mounted after the SPA switched routes is already playing by the
		// time this listener exists; its `play` event is in the past. Registration
		// is the remaining lifecycle evidence, so an already-playing element must
		// run the same admission `play` would have run (I8). Without this the live
		// element never becomes the selection, its `volumechange` stays on the
		// unselected path, and control only arrives when the viewer clicks it.
		// An empty selection is admitted by the enclosing discovery batch instead,
		// so registration never churns the initial selection.
		if (this.activeMediaId !== null && !element.paused) this.admitBetterCandidate(true);
	}

	private unregister(element: HTMLMediaElement): void {
		const record = this.byElement.get(element);
		if (!record) return;
		// Retire the identity before notifying observers. State transitions must not
		// depend on a listener: an observer that throws would otherwise leave the
		// registry half unregistered, and every later intent would miss both the
		// retired identity and its successor.
		record.dispose();
		this.intersectionObserver.unobserve(element);
		this.byElement.delete(element);
		this.byId.delete(record.target.mediaId);
		if (this.activeMediaId === record.target.mediaId) this.activeMediaId = null;
		if (this.activeVideoId === record.target.mediaId) this.activeVideoId = null;
		if (this.fullscreenMediaId === record.target.mediaId) this.fullscreenMediaId = null;
		if (this.selectedTargetKey === this.targetKey(record.target)) {
			this.selectedTargetKey = null;
			this.selectedIdentityKey = null;
		}
		// A pin or an explicit pick belonged to the element that just left. Keeping
		// the key would let a detached identity protect its successor's slot, which
		// is exactly what blocked the live replacement after a video -> live swap.
		if (this.explicitSelectionKey === this.targetKey(record.target)) this.explicitSelectionKey = null;
		if (this.pausedSelectionKey === this.targetKey(record.target)) this.pausedSelectionKey = null;
		this.retireControlIdentity(record.target);
		this.rebuildMediaAttributeObservation();
		this.emit(record.target, 'removed', element, 'detached');
	}

	private retireControlIdentity(target: MediaTarget): void {
		const key = `${target.documentId}:${target.frameId}:${target.mediaId}`;
		this.retiredControlIds.delete(key);
		this.retiredControlIds.set(key, target.kind);
		while (this.retiredControlIds.size > 256) {
			const oldest = this.retiredControlIds.keys().next().value;
			if (oldest === undefined) break;
			this.retiredControlIds.delete(oldest);
		}
	}

	/** True only for an identity this registry registered and then retired. */
	wasRetiredControl(target: MediaTarget | null): boolean {
		if (!target) return false;
		return this.retiredControlIds.has(`${target.documentId}:${target.frameId}:${target.mediaId}`);
	}

	/**
	 * Compact control-state digest for a stale failure. A stale write must carry
	 * the identities it compared, otherwise the report is only a symptom
	 * (SP-22.3 §2).
	 */
	describeMedia(): string {
		const records = [...this.byId.values()].map((record) => `${record.target.mediaId}@${record.target.sourceRevision}`
			+ `(${record.target.kind},paused=${record.element.paused},ended=${record.element.ended}`
			+ `,area=${Math.round(record.visibleArea)},hidden=${record.presentationHidden}`
			+ `,connected=${record.element.isConnected})`);
		// The document identity is part of the digest: a stale write must be
		// distinguishable from a superseded player inside the same document.
		return `document=${this.documentId} selected=${this.activeMediaId ?? 'none'}; media=[${records.join(' ')}]`;
	}

	private successorFor(target: MediaTarget): MediaRecord | null {
		const active = this.activeMediaId ? this.byId.get(this.activeMediaId) : undefined;
		if (!active || active.target.kind !== target.kind) return null;
		const key = `${target.documentId}:${target.frameId}:${target.mediaId}`;
		return this.retiredControlIds.get(key) === target.kind ? active : null;
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
		// A reused <audio>/<video> element is a new *resource* identity, not a new
		// control identity: the viewer still controls the same element. Emit a
		// logical removal before incrementing the revision so every resource-scoped
		// owner can dispose baselines, CSS/overlay state and graph routing without
		// polling or command-time scans, then re-register the same element under
		// its new revision. Selection stays on the element, so the re-selection
		// below rebases the published target instead of emptying it.
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

	/** Control identity is the element the viewer controls. `sourceRevision`
	 * describes the resource loaded into it; a site that rewrites `src` on the
	 * live player changes the resource without changing the selection. */
	private controlKey(target: MediaTarget): string {
		return `${target.documentId}:${target.frameId}:${target.mediaId}`;
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
		// A source change on the selected element is a new resource for the same
		// control identity. Projection and replay still need the event, but the
		// viewer's selection visit is unchanged: incrementing it here invalidated
		// every in-flight write and every restore obligation on each `src` rewrite,
		// which is what surfaced as `stale-media-source` on recurring live players
		// (SP-22.3 §1/§2).
		const identity = this.controlKey(record.target);
		if (identity !== this.selectedIdentityKey) {
			this.selectedIdentityKey = identity;
			this.selectionVisit += 1;
		}
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
	 *
	 * A pause pin is released for a broadcast that is already running: the pin
	 * means "keep controlling the element I paused", and a paused element is
	 * silent by definition. Keeping it after an SPA has mounted a live page is
	 * what left the broadcast uncontrollable until the viewer clicked it.
	 */
	private isSelectionProtected(
		active: MediaRecord,
		candidate: MediaRecord,
		runningBroadcast = false,
	): boolean {
		// A presentation owner outranks geometry: a hidden fullscreen or PiP player
		// is still the surface the viewer is controlling even when its layout box
		// is empty.
		const presented = document.fullscreenElement;
		if (document.pictureInPictureElement === active.element
			|| presented === active.element
			// A fullscreen player container can contain both a pre-roll and the
			// broadcast. Protect its scope without pinning the pre-roll inside it.
			|| presented instanceof Element && presented.contains(active.element) && !presented.contains(candidate.element)) return true;
		if (this.explicitSelectionKey === this.targetKey(active.target)) return true;
		if (this.pausedSelectionKey === this.targetKey(active.target)
			&& !(runningBroadcast && (active.element.paused || active.element.ended))) return true;
		// Nothing else pins a target. In particular a video whose layout box is
		// empty is no longer a presentation, so an SPA that swaps players must be
		// allowed to hand control to the successor it just mounted (SP-22.3 §2).
		return false;
	}

	private admitBetterCandidate(notify: boolean): void {
		const active = this.activeMediaId ? this.byId.get(this.activeMediaId) : undefined;
		// An empty selection is a retired one. Late geometry may be the only new
		// evidence, so it must run the cold admission instead of returning: a
		// replacement element registered before layout would otherwise never own
		// control until the page plays again (SP-22.3 §2).
		if (!active) {
			this.establishInitialSelection(notify);
			return;
		}
		// A paused selection cannot be what the viewer hears. A broadcast that is
		// already running is proof of a live resource even when the page paints it
		// through a canvas and its layout box stays empty; it may take over only a
		// silent selection, so a playing owner is never churned and a viewer pause
		// stays protected.
		const silent = active.element.paused || active.element.ended;
		const challenger = this.bestRecord([...this.byElement.values()].filter((record) => {
			// A broadcast that is already running is what the viewer hears; it is
			// the only challenger allowed to release a paused-target pin.
			const runningBroadcast = silent && !record.element.paused && isLiveMedia(record.element);
			return record !== active
				&& !record.element.ended
				&& !this.isSelectionProtected(active, record, runningBroadcast)
				&& (!record.element.paused || isLiveMedia(record.element))
				// A hidden or unlaid-out preview is not a presentation. Geometry is
				// what proves the viewer can actually see this element; a live
				// timeline does not. Playback is the exception: a running broadcast
				// is audible, and a silent selection has nothing to protect.
				&& (record.visibleArea > 0 || runningBroadcast);
		}));
		if (!challenger || this.compare(challenger, active) <= 0) return;
		this.selectRecord(challenger, notify);
	}

	private reconcileRetiredSelection(): void {
		if (this.disposed) return;
		const active = this.activeMediaId ? this.byId.get(this.activeMediaId) : undefined;
		if (!active) {
			// The retired target is gone, so there is no viewer pick to protect.
			// Admit the replacement exactly like a cold start: connection is enough
			// because the element is usually registered before layout. Without this
			// fallback the selection stays empty after a video -> live replacement,
			// `selected` never fires again and every hotkey resolves nothing until
			// the page plays or the viewer clicks (SP-22.3 §2).
			const initial = this.best('media');
			if (initial) this.selectRecord(initial, true);
			return;
		}
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
			// The player the viewer owned is still registered but stopped
			// presenting. A live element the page mounts is routinely paused with
			// `readyState = 0` until its first frame, so requiring playback here is
			// exactly what kept the retired video selected until the viewer clicked
			// the broadcast. The newest visible video in the same presentation scope
			// takes over. Requiring a later registration refuses an older pre-roll,
			// and the area guard refuses an older/tiny preview (SP-22.3 §2).
			const successor = this.bestRecord([...this.byElement.values()].filter((record) => (
				record !== active && record.target.kind === 'video'
				&& !record.element.ended && record.visibleArea >= active.visibleArea
				&& record.registrationOrder > active.registrationOrder
			)));
			if (successor) this.selectRecord(successor, true);
			return;
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
		const record = this.recordForTarget(target);
		if (record) this.pausedSelectionKey = this.targetKey(record.target);
	}

	private recordForTarget(target: MediaTarget): MediaRecord | null {
		const record = this.byId.get(target.mediaId);
		// Control identity is the element the viewer controls: document, frame and
		// mediaId. `sourceRevision` describes the resource currently loaded into
		// that element, so a target captured before a `src`/`srcObject`/`load()`
		// change still addresses the same control target. Requiring the revision to
		// match here is what failed every in-flight write on a source change with
		// `stale-media-source` (SP-22.3 §1). Resource-scoped owners listen to
		// `removed(source-change)` / `registered` instead.
		if (record
			&& record.target.documentId === target.documentId
			&& record.target.frameId === target.frameId) return record;
		// The element itself is gone. An intent captured against the retired
		// identity still belongs to this document's presentation, so resolve it to
		// the successor the registry already selected instead of rejecting the very
		// first gesture after an SPA replaced its player (SP-22.3 §2). A target this
		// registry never registered is never remapped.
		return record ? null : this.successorFor(target);
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
			|| record.target.kind === 'video'
				&& (record.element.paused || record.visibleArea <= 0 || record.presentationHidden)
			? 0 : record.lastInteraction;
		// Same tuple the cold admission uses, so a reconcile cannot land on a
		// different target than the bootstrap that preceded it. A live broadcast
		// outranks a finite presentation regardless of which element the viewer
		// clicked earlier: a video -> live swap replaces the presentation, it is not
		// a second parallel player. Inside the same class the recent interaction
		// still settles which player the viewer is actually on.
		const leftRank = mediaRank(left.element, left.visibleArea);
		const rightRank = mediaRank(right.element, right.visibleArea);
		if (leftRank[0] !== rightRank[0]) return leftRank[0] - rightRank[0];
		const interactionDifference = interaction(left) - interaction(right);
		if (interactionDifference !== 0) return interactionDifference;
		if (leftRank[1] !== rightRank[1]) return leftRank[1] - rightRank[1];
		if (leftRank[2] !== rightRank[2]) return leftRank[2] - rightRank[2];
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
		this.selectedIdentityKey = null;
	}
}
