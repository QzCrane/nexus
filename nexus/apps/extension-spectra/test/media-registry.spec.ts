import { describe, expect, mock, test } from 'bun:test';
import { requireValue } from './helpers/require-value';
import type { MediaTarget } from '@nexus/contracts';
import {
	MediaRegistry,
	chooseInitialMedia,
	setActiveMediaRegistry,
} from '../src/content/core/media-registry';
import { DocumentRuntimeContext } from '../src/content/core/content-runtime-context';
import { claimMediaObservationEpoch } from '../src/shared/content-runtime';
import { NativeMediaExecutor } from '../src/content/logic/native-media-executor';
import type { VideoEffectsController } from '../src/content/video/video-effects-controller';
import { isAnyMediaPlaying } from '../src/content/audio/media-detection';
import {
	abLoopTestApi,
	disposeABLoops,
	observeABLoopSources,
	setPointA,
	setPointB,
} from '../src/content/video/ab-loop';
import {
	addMarker,
	disposeMarkers,
	observeMarkerSources,
	timeMarkerTestApi,
} from '../src/content/video/time-marker';

type MutationCallback = (records: MutationRecord[]) => void;

class FakeElement extends EventTarget {
	readonly descendants: FakeMediaElement[] = [];
	isConnected = true;
	rect = {
		left: 0,
		top: 0,
		right: 0,
		bottom: 0,
		width: 0,
		height: 0,
	};

	querySelectorAll(): FakeMediaElement[] {
		return [...this.descendants];
	}

	getBoundingClientRect(): DOMRect {
		return this.rect as DOMRect;
	}

	contains(node: unknown): boolean {
		return node === this || this.descendants.some((descendant) => descendant.contains(node));
	}
}

class FakeMediaElement extends FakeElement {
	currentTime = 0;
	duration = 120;
	seeking = false;
	seekable = { length: 0 } as TimeRanges;
	// Metadata and ranges arrive together on a real element; `isLiveMedia` treats
	// an unbounded duration without them as a resource that delivered nothing.
	buffered = { length: 1 } as TimeRanges;
	paused = true;
	ended = false;
	volume: number;
	muted: boolean;
	playbackRate: number;
	src = '';
	currentSrc = '';
	srcObject: object | null = null;
	readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

	constructor(volume: number, muted = false, playbackRate = 1) {
		super();
		this.volume = volume;
		this.muted = muted;
		this.playbackRate = playbackRate;
	}

	override addEventListener(
		type: string,
		callback: EventListenerOrEventListenerObject | null,
		options?: boolean | AddEventListenerOptions,
	): void {
		if (callback) {
			let listeners = this.listeners.get(type);
			if (!listeners) {
				listeners = new Set();
				this.listeners.set(type, listeners);
			}
			listeners.add(callback);
		}
		super.addEventListener(type, callback, options);
	}

	override removeEventListener(
		type: string,
		callback: EventListenerOrEventListenerObject | null,
		options?: boolean | EventListenerOptions,
	): void {
		if (callback) this.listeners.get(type)?.delete(callback);
		super.removeEventListener(type, callback, options);
	}

	listenerCount(type: string): number {
		return this.listeners.get(type)?.size ?? 0;
	}
}

class FakeVideoElement extends FakeMediaElement { }

class FakeDocument extends EventTarget {
	readonly documentElement = new FakeElement();
	media: FakeMediaElement[] = [];
	fullscreenElement: FakeElement | FakeMediaElement | null = null;
	pictureInPictureElement: FakeMediaElement | null = null;

	querySelectorAll(): FakeMediaElement[] {
		return [...this.media];
	}

	querySelector(): FakeMediaElement | null {
		return this.media[0] ?? null;
	}
}

class FakeMutationObserver {
	static latest: FakeMutationObserver | null = null;
	readonly observe = mock(() => undefined);
	readonly disconnect = mock(() => undefined);

	constructor(readonly callback: MutationCallback) {
		FakeMutationObserver.latest = this;
	}

	emit(added: FakeMediaElement[] = [], removed: FakeMediaElement[] = []): void {
		this.callback([{
			addedNodes: added,
			removedNodes: removed,
		} as unknown as MutationRecord]);
	}

	emitAttribute(target: FakeMediaElement, attributeName: string): void {
		this.callback([{
			type: 'attributes',
			target,
			attributeName,
			addedNodes: [],
			removedNodes: [],
		} as unknown as MutationRecord]);
	}
}

class FakeIntersectionObserver {
	static latest: FakeIntersectionObserver | null = null;
	readonly observe = mock(() => undefined);
	readonly unobserve = mock(() => undefined);
	readonly disconnect = mock(() => undefined);

	constructor(readonly callback: IntersectionObserverCallback) {
		FakeIntersectionObserver.latest = this;
	}

	emit(elements: FakeMediaElement[]): void {
		this.callback(elements.map((target) => ({
			target,
			isIntersecting: target.rect.width > 0 && target.rect.height > 0,
			intersectionRect: target.rect,
			boundingClientRect: target.rect,
		})) as unknown as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
	}
}

describe('event-driven media registry', () => {
	test.each(['stable', 'replayed', 'selection-changed'] as const)('establishes the cold paused target before its first own play (%s)', async (mode) => {
		const descriptors = captureGlobalDescriptors(['document', 'Node', 'Element', 'HTMLMediaElement', 'HTMLVideoElement',
			'MutationObserver', 'IntersectionObserver', 'requestAnimationFrame', 'cancelAnimationFrame']);
		const document = new FakeDocument(); const first = new FakeVideoElement(1); const second = new FakeVideoElement(1);
		first.rect = { left: 0, top: 0, right: 320, bottom: 180, width: 320, height: 180 };
		second.rect = { ...first.rect, right: 160, bottom: 90, width: 160, height: 90 };
		document.documentElement.descendants.push(first, second);
		installGlobal('document', document); installGlobal('Node', EventTarget); installGlobal('Element', FakeElement);
		installGlobal('HTMLMediaElement', FakeMediaElement); installGlobal('HTMLVideoElement', FakeVideoElement);
		installGlobal('MutationObserver', FakeMutationObserver); installGlobal('IntersectionObserver', FakeIntersectionObserver);
		installGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0));
		installGlobal('cancelAnimationFrame', (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle));
		const events: string[] = [];
		const registry = new MediaRegistry(new DocumentRuntimeContext({ documentId: `document:cold-play-${mode}`, frameId: 0 }),
			(_target, event) => events.push(event));
		const executor = new NativeMediaExecutor(registry, { dispose() {} } as VideoEffectsController);
		let writes = 0;
		Object.defineProperty(first, 'play', { value: () => {
			writes += 1; first.paused = false;
			queueMicrotask(() => {
				first.dispatchEvent(new Event('play'));
				if (mode === 'replayed') first.paused = true;
			});
			return new Promise<void>(() => undefined);
		} });
		try {
			const target = requireValue(registry.resolve(null)?.target, 'Expected a cold paused target');
			const initialVisit = registry.selectionRevision;
			expect(initialVisit).toBeGreaterThan(0);
			expect(events.filter((event) => event === 'selected')).toEqual([]);
			const operation = executor.execute({ intentId: `cold-play:${mode}`, tabId: 7, documentId: registry.documentId,
				generation: 1, baseRevision: 0, source: 'popup', requestedCoverage: 'active-target', target,
				actualContext: {}, patch: { playing: true } });
			await Promise.resolve();
			expect(registry.selectionRevision).toBe(initialVisit);
			if (mode === 'selection-changed') {
				const next = requireValue(registry.list().find(({ element }) => element === second)?.target, 'Expected second target');
				registry.select(next);
				// A cold play() awaits its proof, so the switch has a window in which
				// it must win: acknowledging the old target after the viewer selected
				// another one is exactly the stale write the fence exists for.
				await expect(operation).rejects.toMatchObject({ code: 'stale-media-source' });
				expect(registry.resolve(null)?.target).toEqual(next);
			} else {
				const result = await operation;
				expect(result.fields.playing).toMatchObject(mode === 'stable'
					? { phase: 'applied', actual: true }
					: { phase: 'error', lastError: { code: 'readback-mismatch' } });
				expect(registry.selectionRevision).toBe(initialVisit);
			}
			expect(writes).toBe(1);
		} finally { executor.dispose(); registry.dispose(); restoreGlobalDescriptors(descriptors); }
	});
	test('establishes the first late paused discovery batch and notifies its selected target once', () => {
		const descriptors = captureGlobalDescriptors(['document', 'Node', 'Element', 'HTMLMediaElement', 'HTMLVideoElement',
			'MutationObserver', 'IntersectionObserver']);
		const document = new FakeDocument();
		installGlobal('document', document); installGlobal('Node', EventTarget); installGlobal('Element', FakeElement);
		installGlobal('HTMLMediaElement', FakeMediaElement); installGlobal('HTMLVideoElement', FakeVideoElement);
		installGlobal('MutationObserver', FakeMutationObserver); installGlobal('IntersectionObserver', FakeIntersectionObserver);
		const selected: MediaTarget[] = [];
		const registry = new MediaRegistry(new DocumentRuntimeContext({ documentId: 'document:late-paused', frameId: 0 }),
			(target, event) => { if (event === 'selected') selected.push(target); });
		try {
			expect(registry.resolve(null)).toBeNull(); expect(registry.selectionRevision).toBe(0);
			const small = new FakeVideoElement(1); const large = new FakeVideoElement(1);
			small.rect = { left: 0, top: 0, right: 160, bottom: 90, width: 160, height: 90 };
			large.rect = { ...small.rect, right: 640, bottom: 360, width: 640, height: 360 };
			FakeMutationObserver.latest?.emit([small, large]);
			expect(registry.resolve(null)?.element).toBe(large); expect(registry.selectionRevision).toBe(1);
			expect(selected).toEqual([registry.resolve(null)?.target]);
			large.paused = false; large.dispatchEvent(new Event('play'));
			expect(registry.selectionRevision).toBe(1); expect(selected).toHaveLength(1);
		} finally { registry.dispose(); restoreGlobalDescriptors(descriptors); }
	});
	test('self-heals the selection when a live replacement registers before layout and the old target unregisters', async () => {
		const descriptors = captureGlobalDescriptors(['document', 'Node', 'Element', 'HTMLMediaElement', 'HTMLVideoElement',
			'MutationObserver', 'IntersectionObserver']);
		const document = new FakeDocument();
		const oldVideo = new FakeVideoElement(1);
		oldVideo.paused = false;
		oldVideo.rect = { left: 0, top: 0, right: 640, bottom: 360, width: 640, height: 360 };
		document.documentElement.descendants.push(oldVideo);
		installGlobal('document', document); installGlobal('Node', EventTarget); installGlobal('Element', FakeElement);
		installGlobal('HTMLMediaElement', FakeMediaElement); installGlobal('HTMLVideoElement', FakeVideoElement);
		installGlobal('MutationObserver', FakeMutationObserver); installGlobal('IntersectionObserver', FakeIntersectionObserver);
		const selected: MediaTarget[] = [];
		const registry = new MediaRegistry(new DocumentRuntimeContext({ documentId: 'document:video-to-live', frameId: 0 }),
			(target, event) => { if (event === 'selected') selected.push(target); });
		try {
			const before = requireValue(registry.resolve(null)?.target, 'Expected the playing video to be selected');
			const live = new FakeVideoElement(1);
			// The live player is inserted before layout, and the old element is
			// removed in the same observer batch. Geometry cannot admit it, and the
			// retired selection must not stay empty (SP-22.3 §2).
			oldVideo.isConnected = false;
			document.documentElement.descendants = [live];
			document.media = [live];
			FakeMutationObserver.latest?.emit([live], [oldVideo]);
			await Promise.resolve();
			const after = requireValue(registry.resolve(null)?.target, 'Expected the replacement to be selected');
			expect(after.mediaId).not.toBe(before.mediaId);
			expect(registry.resolve(null)?.element).toBe(live);
			expect(selected.at(-1)?.mediaId).toBe(after.mediaId);
		} finally { registry.dispose(); restoreGlobalDescriptors(descriptors); }
	});
	test('admits an already-playing broadcast that registers after its first play (I8)', () => {
		const descriptors = captureGlobalDescriptors(['document', 'Node', 'Element', 'HTMLMediaElement', 'HTMLVideoElement',
			'MutationObserver', 'IntersectionObserver']);
		const document = new FakeDocument();
		const feed = new FakeVideoElement(1);
		feed.paused = false;
		feed.rect = { left: 0, top: 0, right: 640, bottom: 360, width: 640, height: 360 };
		document.documentElement.descendants.push(feed);
		document.media = [feed];
		installGlobal('document', document); installGlobal('Node', EventTarget); installGlobal('Element', FakeElement);
		installGlobal('HTMLMediaElement', FakeMediaElement); installGlobal('HTMLVideoElement', FakeVideoElement);
		installGlobal('MutationObserver', FakeMutationObserver); installGlobal('IntersectionObserver', FakeIntersectionObserver);
		const selected: MediaTarget[] = [];
		const registry = new MediaRegistry(new DocumentRuntimeContext({ documentId: 'document:register-admits', frameId: 0 }),
			(target, event) => { if (event === 'selected') selected.push(target); });
		try {
			const before = requireValue(registry.resolve(null)?.target, 'Expected the feed to own control');
			expect(before.mediaId).toBe(requireValue(registry.list().find(({ element }) => element === feed)?.target).mediaId);
			// The SPA overlay pauses the feed and mounts the broadcast already playing.
			// Its `play` happened before this listener existed, so registration is the
			// only remaining lifecycle evidence; a canvas-rendered live player is 0x0.
			feed.paused = true;
			const live = new FakeVideoElement(1);
			live.paused = false;
			live.duration = Number.POSITIVE_INFINITY;
			live.rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
			document.documentElement.descendants.push(live);
			document.media = [feed, live];
			const revision = registry.selectionRevision;
			FakeMutationObserver.latest?.emit([live]);
			expect(registry.resolve(null)?.element).toBe(live);
			expect(registry.selectionRevision).toBeGreaterThan(revision);
			expect(selected.at(-1)).toEqual(registry.resolve(null)?.target);
		} finally { registry.dispose(); restoreGlobalDescriptors(descriptors); }
	});

	test('registration never steals control from a playing owner or a paused pick', () => {
		const descriptors = captureGlobalDescriptors(['document', 'Node', 'Element', 'HTMLMediaElement', 'HTMLVideoElement',
			'MutationObserver', 'IntersectionObserver']);
		const document = new FakeDocument();
		const owner = new FakeVideoElement(1);
		owner.paused = false;
		owner.rect = { left: 0, top: 0, right: 640, bottom: 360, width: 640, height: 360 };
		document.documentElement.descendants.push(owner);
		document.media = [owner];
		installGlobal('document', document); installGlobal('Node', EventTarget); installGlobal('Element', FakeElement);
		installGlobal('HTMLMediaElement', FakeMediaElement); installGlobal('HTMLVideoElement', FakeVideoElement);
		installGlobal('MutationObserver', FakeMutationObserver); installGlobal('IntersectionObserver', FakeIntersectionObserver);
		const selected: MediaTarget[] = [];
		const registry = new MediaRegistry(new DocumentRuntimeContext({ documentId: 'document:register-restraint', frameId: 0 }),
			(target, event) => { if (event === 'selected') selected.push(target); });
		try {
			const before = requireValue(registry.resolve(null)?.target, 'Expected the playing owner to be selected');
			const initialSelections = selected.length;
			const revision = registry.selectionRevision;
			const stopped = new FakeVideoElement(1);
			stopped.rect = { left: 0, top: 0, right: 320, bottom: 180, width: 320, height: 180 };
			const hiddenMixed = new FakeVideoElement(1);
			hiddenMixed.paused = false;
			hiddenMixed.rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
			document.documentElement.descendants.push(stopped, hiddenMixed);
			document.media = [owner, stopped, hiddenMixed];
			FakeMutationObserver.latest?.emit([stopped, hiddenMixed]);
			expect(registry.resolve(null)?.target).toEqual(before);
			expect(registry.selectionRevision).toBe(revision);
			expect(selected).toHaveLength(initialSelections);
		} finally { registry.dispose(); restoreGlobalDescriptors(descriptors); }
	});

	test.each(['audio', 'pip', 'fullscreen'] as const)('establishes independent initial media and video scopes (%s)', (presentation) => {
		const descriptors = captureGlobalDescriptors(['document', 'Node', 'Element', 'HTMLMediaElement', 'HTMLVideoElement',
			'MutationObserver', 'IntersectionObserver']);
		const document = new FakeDocument(); const audio = new FakeMediaElement(1); const video = new FakeVideoElement(1);
		audio.paused = false; video.rect = { left: 0, top: 0, right: 320, bottom: 180, width: 320, height: 180 };
		if (presentation === 'pip') document.pictureInPictureElement = video;
		if (presentation === 'fullscreen') document.fullscreenElement = video;
		document.documentElement.descendants.push(audio, video);
		installGlobal('document', document); installGlobal('Node', EventTarget); installGlobal('Element', FakeElement);
		installGlobal('HTMLMediaElement', FakeMediaElement); installGlobal('HTMLVideoElement', FakeVideoElement);
		installGlobal('MutationObserver', FakeMutationObserver); installGlobal('IntersectionObserver', FakeIntersectionObserver);
		const registry = new MediaRegistry(new DocumentRuntimeContext({ documentId: `document:initial-${presentation}`, frameId: 0 }));
		try {
			expect(registry.selectionRevision).toBe(1);
			expect(registry.resolve(null)?.element).toBe(presentation === 'audio' ? audio : video);
			expect(registry.resolveVideo(null)?.element).toBe(video);
			if (presentation === 'audio') {
				video.paused = false; video.dispatchEvent(new Event('play'));
				expect(registry.resolve(null)?.element).toBe(video);
				expect(registry.selectionRevision).toBe(2);
			}
		} finally { registry.dispose(); restoreGlobalDescriptors(descriptors); }
	});

	test('allocates observation owners from the document-start counter across registry replacements', () => {
		const descriptors = captureGlobalDescriptors(['window', 'document', 'Node', 'Element', 'HTMLMediaElement', 'HTMLVideoElement', 'MutationObserver', 'IntersectionObserver']);
		const document = new FakeDocument();
		installGlobal('window', { __SPECTRA_CONTENT_BOOTSTRAP__: { mediaOwnerEpoch: 7 }, innerWidth: 1280, innerHeight: 720 });
		installGlobal('document', document); installGlobal('Node', EventTarget); installGlobal('Element', FakeElement);
		installGlobal('HTMLMediaElement', FakeMediaElement); installGlobal('HTMLVideoElement', FakeVideoElement);
		installGlobal('MutationObserver', FakeMutationObserver); installGlobal('IntersectionObserver', FakeIntersectionObserver);
		const context = new DocumentRuntimeContext({ documentId: 'document:owner-replacement', frameId: 0 });
		const first = new MediaRegistry(context);
		const passiveEpoch = claimMediaObservationEpoch();
		const second = new MediaRegistry(context);
		try {
			expect(first.captureObservation().owner).toBe('document:owner-replacement:8');
			expect(passiveEpoch).toBe(9);
			expect(second.captureObservation().owner).toBe('document:owner-replacement:10');
			expect(first.captureObservation().epoch).toBe(8); expect(second.captureObservation().epoch).toBe(10);
		} finally { first.dispose(); second.dispose(); restoreGlobalDescriptors(descriptors); }
	});
	test('hands control to a paused live replacement once the old player stops', () => {
		// The reported Douyin path: the live element is mounted paused with
		// readyState 0 until its first frame, so it was never admissible as a
		// challenger and the old video kept control until the viewer clicked the
		// broadcast. The old player's pause is the handoff boundary.
		const descriptors = captureGlobalDescriptors(['document', 'Node', 'Element', 'HTMLMediaElement', 'HTMLVideoElement',
			'MutationObserver', 'IntersectionObserver']);
		const document = new FakeDocument();
		const oldVideo = new FakeVideoElement(1);
		const live = new FakeVideoElement(1);
		oldVideo.paused = false;
		oldVideo.rect = { left: 0, top: 0, right: 1_280, bottom: 720, width: 1_280, height: 720 };
		live.paused = true;
		live.duration = Number.NaN;
		live.rect = { left: 0, top: 0, right: 1_280, bottom: 720, width: 1_280, height: 720 };
		document.documentElement.descendants.push(oldVideo);
		installGlobal('document', document); installGlobal('Node', EventTarget); installGlobal('Element', FakeElement);
		installGlobal('HTMLMediaElement', FakeMediaElement); installGlobal('HTMLVideoElement', FakeVideoElement);
		installGlobal('MutationObserver', FakeMutationObserver); installGlobal('IntersectionObserver', FakeIntersectionObserver);
		const selected: MediaTarget[] = [];
		const registry = new MediaRegistry(new DocumentRuntimeContext({ documentId: 'document:paused-live-handoff', frameId: 0 }),
			(target, event) => { if (event === 'selected') selected.push(target); });
		try {
			for (const listener of oldVideo.listeners.get('pointerdown') ?? []) {
				if (typeof listener === 'function') listener.call(oldVideo, { isTrusted: true } as Event);
			}
			expect(registry.resolve(null)?.element).toBe(oldVideo);
			document.documentElement.descendants.push(live);
			FakeMutationObserver.latest?.emit([live]);
			// A readyState-0 live element cannot win while the old player still runs.
			expect(registry.resolve(null)?.element).toBe(oldVideo);
			oldVideo.paused = true;
			oldVideo.dispatchEvent(new Event('pause'));
			expect(registry.resolve(null)?.element).toBe(live);
			expect(selected.at(-1)?.mediaId).toBe(registry.resolve(null)?.target.mediaId);
		} finally { registry.dispose(); restoreGlobalDescriptors(descriptors); }
	});

	test('hands control to a live broadcast beside a pre-roll the viewer clicked', () => {
		// Video -> live is a presentation replacement, not a second player. The
		// click that selected the finite pre-roll is historical evidence and must
		// not outrank the live broadcast the viewer is now watching, otherwise the
		// first gesture after the swap keeps controlling the retired player.
		const descriptors = captureGlobalDescriptors(['document', 'Node', 'Element', 'HTMLMediaElement', 'HTMLVideoElement',
			'MutationObserver', 'IntersectionObserver']);
		const document = new FakeDocument();
		const preRoll = new FakeVideoElement(1);
		const live = new FakeVideoElement(1);
		preRoll.paused = false;
		preRoll.duration = 8;
		preRoll.rect = { left: 50, top: 60, right: 1_330, bottom: 640, width: 1_280, height: 580 };
		live.paused = false;
		live.duration = Number.POSITIVE_INFINITY;
		live.rect = { left: 0, top: 0, right: 1_280, bottom: 720, width: 1_280, height: 720 };
		document.documentElement.descendants.push(preRoll);
		installGlobal('document', document); installGlobal('Node', EventTarget); installGlobal('Element', FakeElement);
		installGlobal('HTMLMediaElement', FakeMediaElement); installGlobal('HTMLVideoElement', FakeVideoElement);
		installGlobal('MutationObserver', FakeMutationObserver); installGlobal('IntersectionObserver', FakeIntersectionObserver);
		const selected: MediaTarget[] = [];
		const registry = new MediaRegistry(new DocumentRuntimeContext({ documentId: 'document:pre-roll-to-live', frameId: 0 }),
			(target, event) => { if (event === 'selected') selected.push(target); });
		try {
			for (const listener of preRoll.listeners.get('pointerdown') ?? []) {
				if (typeof listener === 'function') listener.call(preRoll, { isTrusted: true } as Event);
			}
			expect(registry.resolve(null)?.element).toBe(preRoll);
			document.documentElement.descendants.push(live);
			FakeMutationObserver.latest?.emit([live]);
			live.dispatchEvent(new Event('play'));
			expect(registry.resolve(null)?.element).toBe(live);
			expect(selected.at(-1)?.mediaId).toBe(registry.resolve(null)?.target.mediaId);
		} finally { registry.dispose(); restoreGlobalDescriptors(descriptors); }
	});

	test('resolves a retired control identity to the selected successor', async () => {
		// The background projects the last announced target. When the page replaces
		// the element, the first intent still carries the retired mediaId; the
		// registry owns that document's presentation and must answer with the
		// successor instead of making the viewer repeat the gesture (SP-22.3 §2).
		const descriptors = captureGlobalDescriptors(['document', 'Node', 'Element', 'HTMLMediaElement', 'HTMLVideoElement',
			'MutationObserver', 'IntersectionObserver']);
		const document = new FakeDocument();
		const oldVideo = new FakeVideoElement(1);
		oldVideo.paused = false;
		oldVideo.rect = { left: 0, top: 0, right: 640, bottom: 360, width: 640, height: 360 };
		document.documentElement.descendants.push(oldVideo);
		installGlobal('document', document); installGlobal('Node', EventTarget); installGlobal('Element', FakeElement);
		installGlobal('HTMLMediaElement', FakeMediaElement); installGlobal('HTMLVideoElement', FakeVideoElement);
		installGlobal('MutationObserver', FakeMutationObserver); installGlobal('IntersectionObserver', FakeIntersectionObserver);
		const registry = new MediaRegistry(new DocumentRuntimeContext({ documentId: 'document:retired-identity', frameId: 0 }));
		try {
			const retired = requireValue(registry.resolve(null)?.target, 'Expected the old player to be selected');
			const live = new FakeVideoElement(1);
			live.paused = false;
			live.duration = Number.POSITIVE_INFINITY;
			live.rect = { left: 0, top: 0, right: 1_280, bottom: 720, width: 1_280, height: 720 };
			oldVideo.isConnected = false;
			document.documentElement.descendants = [live];
			document.media = [live];
			FakeMutationObserver.latest?.emit([live], [oldVideo]);
			await Promise.resolve();
			const successor = requireValue(registry.resolve(null)?.target, 'Expected the live player to be selected');
			expect(successor.mediaId).not.toBe(retired.mediaId);
			expect(registry.wasRetiredControl(retired)).toBe(true);
			expect(registry.resolve(retired)?.element).toBe(live);
		} finally { registry.dispose(); restoreGlobalDescriptors(descriptors); }
	});

	test('serves the first gesture after a player replacement from the retired identity', async () => {
		const descriptors = captureGlobalDescriptors(['document', 'Node', 'Element', 'HTMLMediaElement', 'HTMLVideoElement',
			'MutationObserver', 'IntersectionObserver', 'requestAnimationFrame', 'cancelAnimationFrame']);
		const document = new FakeDocument();
		const oldVideo = new FakeVideoElement(1);
		oldVideo.paused = false;
		oldVideo.rect = { left: 0, top: 0, right: 640, bottom: 360, width: 640, height: 360 };
		document.documentElement.descendants.push(oldVideo);
		installGlobal('document', document); installGlobal('Node', EventTarget); installGlobal('Element', FakeElement);
		installGlobal('HTMLMediaElement', FakeMediaElement); installGlobal('HTMLVideoElement', FakeVideoElement);
		installGlobal('MutationObserver', FakeMutationObserver); installGlobal('IntersectionObserver', FakeIntersectionObserver);
		installGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0));
		installGlobal('cancelAnimationFrame', (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle));
		const registry = new MediaRegistry(new DocumentRuntimeContext({ documentId: 'document:first-gesture', frameId: 0 }));
		const executor = new NativeMediaExecutor(registry, {
			dispose() {},
			release() {},
			retireSource() {},
		} as unknown as VideoEffectsController);
		try {
			const retired = requireValue(registry.resolve(null)?.target, 'Expected the old player to be selected');
			const live = new FakeVideoElement(1);
			live.paused = false;
			live.duration = Number.POSITIVE_INFINITY;
			live.rect = { left: 0, top: 0, right: 1_280, bottom: 720, width: 1_280, height: 720 };
			Object.defineProperty(live, 'pause', { configurable: true, value: () => {
				live.paused = true;
				queueMicrotask(() => live.dispatchEvent(new Event('pause')));
			} });
			oldVideo.isConnected = false;
			document.documentElement.descendants = [live];
			document.media = [live];
			FakeMutationObserver.latest?.emit([live], [oldVideo]);
			await Promise.resolve();
			const successor = requireValue(registry.resolve(null)?.target, 'Expected the live player to be selected');
			const ack = await executor.execute({
				intentId: 'intent:first-gesture-after-replacement',
				tabId: 7,
				documentId: registry.documentId,
				generation: 1,
				baseRevision: 0,
				source: 'hotkey',
				requestedCoverage: 'active-target',
				target: retired,
				actualContext: {},
				patch: { playing: false },
			});
			expect(ack.target?.mediaId).toBe(successor.mediaId);
			expect(ack.fields.playing).toMatchObject({ phase: 'applied', actual: false });
		} finally { executor.dispose(); registry.dispose(); restoreGlobalDescriptors(descriptors); }
	});

	test('moves an in-flight gesture to the successor when the player is replaced mid-write', async () => {
		// The message can arrive while the old element is still registered. The
		// write then starts on the identity the intent named and the replacement
		// lands inside its await window. One retry against the successor keeps the
		// gesture effective; a target that merely lost the selection is not retried.
		const descriptors = captureGlobalDescriptors(['document', 'Node', 'Element', 'HTMLMediaElement', 'HTMLVideoElement',
			'MutationObserver', 'IntersectionObserver', 'requestAnimationFrame', 'cancelAnimationFrame']);
		const document = new FakeDocument();
		const oldVideo = new FakeVideoElement(1);
		oldVideo.paused = false;
		oldVideo.rect = { left: 0, top: 0, right: 640, bottom: 360, width: 640, height: 360 };
		document.documentElement.descendants.push(oldVideo);
		installGlobal('document', document); installGlobal('Node', EventTarget); installGlobal('Element', FakeElement);
		installGlobal('HTMLMediaElement', FakeMediaElement); installGlobal('HTMLVideoElement', FakeVideoElement);
		installGlobal('MutationObserver', FakeMutationObserver); installGlobal('IntersectionObserver', FakeIntersectionObserver);
		installGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0));
		installGlobal('cancelAnimationFrame', (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle));
		const registry = new MediaRegistry(new DocumentRuntimeContext({ documentId: 'document:mid-write-replacement', frameId: 0 }));
		const executor = new NativeMediaExecutor(registry, {
			dispose() {},
			release() {},
			retireSource() {},
		} as unknown as VideoEffectsController);
		try {
			const retired = requireValue(registry.resolve(null)?.target, 'Expected the old player to be selected');
			const live = new FakeVideoElement(1);
			live.paused = false;
			live.duration = Number.POSITIVE_INFINITY;
			live.rect = { left: 0, top: 0, right: 1_280, bottom: 720, width: 1_280, height: 720 };
			Object.defineProperty(live, 'pause', { configurable: true, value: () => {
				live.paused = true;
				queueMicrotask(() => live.dispatchEvent(new Event('pause')));
			} });
			const operation = executor.execute({
				intentId: 'intent:mid-write-replacement',
				tabId: 7,
				documentId: registry.documentId,
				generation: 1,
				baseRevision: 0,
				source: 'hotkey',
				requestedCoverage: 'active-target',
				target: retired,
				actualContext: {},
				patch: { playing: false },
			});
			oldVideo.isConnected = false;
			document.documentElement.descendants = [live];
			document.media = [live];
			FakeMutationObserver.latest?.emit([live], [oldVideo]);
			await Promise.resolve();
			const successor = requireValue(registry.resolve(null)?.target, 'Expected the live player to be selected');
			const ack = await operation;
			expect(ack.target?.mediaId).toBe(successor.mediaId);
			expect(ack.fields.playing).toMatchObject({ phase: 'applied', actual: false });
		} finally { executor.dispose(); registry.dispose(); restoreGlobalDescriptors(descriptors); }
	});

	test.each(['handoff', 'explicit-pause', 'resumed-pause', 'explicit-selection', 'preview'] as const)('reconciles a later player after the historical feed pauses (%s)', (mode) => {
		const descriptors = captureGlobalDescriptors(['document', 'Node', 'Element', 'HTMLMediaElement', 'HTMLVideoElement', 'MutationObserver', 'IntersectionObserver']);
		const document = new FakeDocument();
		const feed = new FakeVideoElement(1);
		const live = new FakeVideoElement(1);
		feed.paused = false;
		feed.rect = { left: 0, top: 0, right: 320, bottom: 180, width: 320, height: 180 };
		live.rect = mode === 'preview' ? { ...feed.rect, width: 32, height: 18 } : { ...feed.rect, width: 640, height: 360 };
		document.documentElement.descendants.push(feed, live);
		installGlobal('document', document); installGlobal('Node', EventTarget); installGlobal('Element', FakeElement);
		installGlobal('HTMLMediaElement', FakeMediaElement); installGlobal('HTMLVideoElement', FakeVideoElement);
		installGlobal('MutationObserver', FakeMutationObserver); installGlobal('IntersectionObserver', FakeIntersectionObserver);
		const registry = new MediaRegistry(new DocumentRuntimeContext({ documentId: `document:handoff-${mode}`, frameId: 0 }));
		try {
			feed.dispatchEvent(new Event('play'));
			for (const listener of feed.listeners.get('pointerdown') ?? []) {
				if (typeof listener === 'function') listener.call(feed, { isTrusted: true } as Event);
			}
			const feedTarget = registry.resolve(null)?.target;
			if (!feedTarget) throw new Error('Feed target is missing');
			if (mode === 'explicit-pause') registry.pinPaused(feedTarget);
			if (mode === 'resumed-pause') { registry.pinPaused(feedTarget); feed.dispatchEvent(new Event('play')); }
			if (mode === 'explicit-selection') registry.select(feedTarget);
			live.paused = false; live.dispatchEvent(new Event('play'));
			expect(registry.resolve(null)?.element).toBe(feed);
			feed.paused = true; feed.dispatchEvent(new Event('pause'));
			expect(registry.resolve(null)?.element).toBe(mode === 'handoff' || mode === 'resumed-pause' ? live : feed);
		} finally { registry.dispose(); restoreGlobalDescriptors(descriptors); }
	});

	test('keeps the same selection visit when a playing source scrolls outside the viewport and back', () => {
		const descriptors = captureGlobalDescriptors(['document', 'Node', 'Element', 'HTMLMediaElement', 'HTMLVideoElement', 'MutationObserver', 'IntersectionObserver']);
		const document = new FakeDocument();
		const media = new FakeVideoElement(0.8);
		media.paused = false;
		media.rect = { left: 0, top: 0, right: 320, bottom: 180, width: 320, height: 180 };
		document.documentElement.descendants.push(media);
		installGlobal('document', document); installGlobal('Node', EventTarget); installGlobal('Element', FakeElement);
		installGlobal('HTMLMediaElement', FakeMediaElement); installGlobal('HTMLVideoElement', FakeVideoElement);
		installGlobal('MutationObserver', FakeMutationObserver); installGlobal('IntersectionObserver', FakeIntersectionObserver);
		const registry = new MediaRegistry(new DocumentRuntimeContext({ documentId: 'document:scroll-visit', frameId: 0 }));
		try {
			const before = registry.captureObservation();
			const selected: MediaTarget[] = [];
			registry.subscribe((target, event) => { if (event === 'selected') selected.push(target); });
			media.rect = { ...media.rect, top: -400, bottom: -220 };
			const observer = requireValue(FakeIntersectionObserver.latest, 'Missing intersection observer');
			observer.callback([{ target: media, isIntersecting: false, boundingClientRect: media.rect,
				intersectionRect: { width: 0, height: 0 } } as unknown as IntersectionObserverEntry],
				observer as unknown as IntersectionObserver);
			media.rect = { ...media.rect, top: 0, bottom: 180 };
			observer.emit([media]);
			expect(registry.captureObservation().selection).toBe(before.selection);
			expect(selected).toEqual([]);
			expect(registry.resolve(null)?.element).toBe(media);
		} finally { registry.dispose(); restoreGlobalDescriptors(descriptors); }
	});

	test('publishes a new visit when the same selected source returns from hidden presentation', () => {
		const descriptors = captureGlobalDescriptors(['document', 'Node', 'Element', 'HTMLMediaElement', 'HTMLVideoElement', 'MutationObserver', 'IntersectionObserver']);
		const document = new FakeDocument(); const media = new FakeVideoElement(1);
		media.rect = { left: 0, top: 0, right: 320, bottom: 180, width: 320, height: 180 };
		document.documentElement.descendants.push(media);
		installGlobal('document', document); installGlobal('Node', EventTarget); installGlobal('Element', FakeElement);
		installGlobal('HTMLMediaElement', FakeMediaElement); installGlobal('HTMLVideoElement', FakeVideoElement);
		installGlobal('MutationObserver', FakeMutationObserver); installGlobal('IntersectionObserver', FakeIntersectionObserver);
		const registry = new MediaRegistry(new DocumentRuntimeContext({ documentId: 'document:return-visit', frameId: 0 }));
		try {
			const target = registry.resolve(null)?.target; if (!target) throw new Error('Missing media');
			registry.select(target); const before = registry.captureObservation();
			const visible = media.rect; media.rect = { ...visible, width: 0, height: 0 };
			FakeIntersectionObserver.latest?.emit([media]); media.rect = visible; FakeIntersectionObserver.latest?.emit([media]);
			const after = registry.captureObservation();
			expect(after.owner).toBe(before.owner); expect(after.selection).toBe(before.selection + 1);
			expect(after.revision).toBeGreaterThan(before.revision); expect(registry.resolve(null)?.target).toEqual(target);
		} finally { registry.dispose(); restoreGlobalDescriptors(descriptors); }
	});
	test('projects only selected processing sources and recomputes URL and srcObject lifecycles', () => {
		const descriptors = captureGlobalDescriptors([
			'document',
			'Node',
			'Element',
			'HTMLMediaElement',
			'HTMLVideoElement',
			'MutationObserver',
			'IntersectionObserver',
		]);
		const document = new FakeDocument();
		const placeholder = new FakeMediaElement(1);
		const urlSource = new FakeMediaElement(1);
		const streamSource = new FakeMediaElement(1);
		document.documentElement.descendants.push(placeholder, urlSource, streamSource);

		installGlobal('document', document);
		installGlobal('Node', EventTarget);
		installGlobal('Element', FakeElement);
		installGlobal('HTMLMediaElement', FakeMediaElement);
		installGlobal('HTMLVideoElement', FakeVideoElement);
		installGlobal('MutationObserver', FakeMutationObserver);
		installGlobal('IntersectionObserver', FakeIntersectionObserver);

		const events: Array<{ target: MediaTarget; event: string }> = [];
		let registry: MediaRegistry | null = null;
		try {
			registry = new MediaRegistry(
				new DocumentRuntimeContext({ documentId: 'document:processing-sources', frameId: 0 }),
				(target, event) => events.push({ target, event }),
			);
			expect(registry.list()).toHaveLength(3);
			expect(registry.listProcessingSources()).toEqual([]);

			const initialUrlTarget = requireValue(
				registry.list().find(({ element }) => element === urlSource)?.target,
				'Expected URL placeholder identity',
			);
			urlSource.src = 'https://media.example/selected.mp3';
			FakeMutationObserver.latest?.emitAttribute(urlSource, 'src');

			const initialStreamTarget = requireValue(
				registry.list().find(({ element }) => element === streamSource)?.target,
				'Expected srcObject placeholder identity',
			);
			streamSource.srcObject = {};
			streamSource.dispatchEvent(new Event('loadstart'));

			expect(registry.listProcessingSources().map(({ element }) => element))
				.toEqual([urlSource, streamSource]);
			expect(registry.listProcessingSources()).not.toContainEqual(
				expect.objectContaining({ element: placeholder }),
			);
			expect(registry.list().find(({ element }) => element === urlSource)?.target)
				.toMatchObject({ mediaId: initialUrlTarget.mediaId, sourceRevision: 1 });
			expect(registry.list().find(({ element }) => element === streamSource)?.target)
				.toMatchObject({ mediaId: initialStreamTarget.mediaId, sourceRevision: 1 });
			expect(events.filter(({ target, event }) => (
				target.mediaId === initialUrlTarget.mediaId
				&& (event === 'removed' || event === 'registered')
			)).map(({ event }) => event)).toEqual(['registered', 'removed', 'registered']);
			expect(events.filter(({ target, event }) => (
				target.mediaId === initialStreamTarget.mediaId
				&& (event === 'removed' || event === 'registered')
			)).map(({ event }) => event)).toEqual(['registered', 'removed', 'registered']);
		} finally {
			registry?.dispose();
			restoreGlobalDescriptors(descriptors);
			FakeMutationObserver.latest = null;
		}
	});

	test('keeps the selection visit stable when the resource revision advances', () => {
		const descriptors = captureGlobalDescriptors(['document', 'Node', 'Element', 'HTMLMediaElement', 'HTMLVideoElement',
			'MutationObserver', 'IntersectionObserver']);
		const document = new FakeDocument();
		const player = new FakeVideoElement(1);
		player.paused = false;
		player.rect = { left: 0, top: 0, right: 1_280, bottom: 720, width: 1_280, height: 720 };
		document.documentElement.descendants.push(player);
		installGlobal('document', document);
		installGlobal('Node', EventTarget);
		installGlobal('Element', FakeElement);
		installGlobal('HTMLMediaElement', FakeMediaElement);
		installGlobal('HTMLVideoElement', FakeVideoElement);
		installGlobal('MutationObserver', FakeMutationObserver);
		installGlobal('IntersectionObserver', FakeIntersectionObserver);
		const selected: string[] = [];
		let registry: MediaRegistry | null = null;
		try {
			registry = new MediaRegistry(new DocumentRuntimeContext({ documentId: 'document:source-churn', frameId: 0 }),
				(target, event) => {
					if (event === 'selected') selected.push(target.mediaId);
				});
			const visit = registry.selectionRevision;
			const target = requireValue(registry.resolve(null)?.target, 'Expected the player target');
			// A recurring player rewrites `src` while the viewer is already
			// controlling it. The resource revision advances, the control identity
			// does not: no new selection visit may invalidate the in-flight write.
			player.src = 'https://example.com/next.mp4';
			player.dispatchEvent(new Event('loadstart'));
			expect(registry.resolve(null)?.target.sourceRevision).toBe(target.sourceRevision + 1);
			expect(registry.selectionRevision).toBe(visit);
			expect(selected).toEqual([target.mediaId]);
		} finally {
			registry?.dispose();
			restoreGlobalDescriptors(descriptors);
			FakeMutationObserver.latest = null;
		}
	});

	test('seeds initial selection from visible geometry before IntersectionObserver delivery', () => {
		const descriptors = captureGlobalDescriptors([
			'document',
			'Node',
			'Element',
			'HTMLMediaElement',
			'HTMLVideoElement',
			'MutationObserver',
			'IntersectionObserver',
		]);
		const document = new FakeDocument();
		const feed = new FakeVideoElement(1);
		const modal = new FakeVideoElement(1);
		const hiddenPreload = new FakeVideoElement(1);
		feed.paused = false;
		modal.paused = false;
		hiddenPreload.paused = false;
		feed.rect = { left: 0, top: 0, right: 320, bottom: 180, width: 320, height: 180 };
		modal.rect = { left: 0, top: 0, right: 1_280, bottom: 720, width: 1_280, height: 720 };
		hiddenPreload.rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
		document.documentElement.descendants.push(feed, modal, hiddenPreload);

		installGlobal('document', document);
		installGlobal('Node', EventTarget);
		installGlobal('Element', FakeElement);
		installGlobal('HTMLMediaElement', FakeMediaElement);
		installGlobal('HTMLVideoElement', FakeVideoElement);
		installGlobal('MutationObserver', FakeMutationObserver);
		installGlobal('IntersectionObserver', FakeIntersectionObserver);

		const events: Array<{ target: MediaTarget; event: string }> = [];
		let registry: MediaRegistry | null = null;
		try {
			registry = new MediaRegistry(
				new DocumentRuntimeContext({ documentId: 'document:initial-visibility', frameId: 0 }),
				(target, event) => events.push({ target, event }),
			);
			const modalTarget = registry.list().find(({ element }) => element === modal)?.target;
			expect(modalTarget).toBeDefined();
			expect(registry.resolve(null)?.target).toEqual(modalTarget);
			expect(chooseInitialMedia([feed, modal, hiddenPreload] as unknown as HTMLMediaElement[])).toBe(modal);
			document.pictureInPictureElement = feed;
			expect(chooseInitialMedia([feed, modal] as unknown as HTMLMediaElement[])).toBe(feed);
			// Stateless cold admission sees presentation; pure reads do not replace
			// the already established visit without its actual lifecycle event.
			expect(registry.resolve(null)?.element).toBe(modal);
			document.pictureInPictureElement = null;
			document.fullscreenElement = feed;
			expect(chooseInitialMedia([feed, modal] as unknown as HTMLMediaElement[])).toBe(feed);
			expect(registry.resolve(null)?.element).toBe(modal);
			document.fullscreenElement = null;
			expect(events.filter(({ event }) => event === 'selected')).toEqual([]);
			FakeIntersectionObserver.latest?.emit([feed, modal, hiddenPreload]);
			expect(events.filter(({ event }) => event === 'selected')).toEqual([]);

			// A background preview can start after the visible modal is already
			// playing. Its play and browser-generated property events are not a
			// user selection of the preview.
			hiddenPreload.dispatchEvent(new Event('play'));
			expect(registry.resolve(null)?.target).toEqual(modalTarget);
			for (const type of ['volumechange', 'ratechange', 'seeked']) {
				const event = new Event(type);
				hiddenPreload.dispatchEvent(event);
				expect(registry.resolve(null)?.target).toEqual(modalTarget);
			}
			expect(events.filter(({ event }) => event === 'selected').every(({ target }) => (
				target.mediaId === modalTarget?.mediaId
			))).toBe(true);
		} finally {
			registry?.dispose();
			restoreGlobalDescriptors(descriptors);
			FakeMutationObserver.latest = null;
		}
	});

	test('admits an already-playing player once geometry proves it is the presentation', () => {
		// A player inserted already playing never fires `play` after its listeners
		// exist, so no lifecycle event can hand it the selection. Geometry is the
		// remaining proof: once it is laid out and genuinely outranks the owner, it
		// takes the visit. A live timeline alone is not that proof.
		const descriptors = captureGlobalDescriptors([
			'document',
			'Node',
			'Element',
			'HTMLMediaElement',
			'HTMLVideoElement',
			'MutationObserver',
			'IntersectionObserver',
		]);
		const document = new FakeDocument();
		const cover = new FakeVideoElement(1, true);
		const live = new FakeVideoElement(0, true);
		cover.paused = false;
		cover.duration = 8;
		cover.rect = { left: 50, top: 60, right: 1_330, bottom: 640, width: 1_280, height: 580 };
		live.paused = false;
		live.duration = Number.POSITIVE_INFINITY;
		// Unlaid-out at registration: no geometry to be admitted on yet.
		live.rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
		document.documentElement.descendants.push(cover);

		installGlobal('document', document);
		installGlobal('Node', EventTarget);
		installGlobal('Element', FakeElement);
		installGlobal('HTMLMediaElement', FakeMediaElement);
		installGlobal('HTMLVideoElement', FakeVideoElement);
		installGlobal('MutationObserver', FakeMutationObserver);
		installGlobal('IntersectionObserver', FakeIntersectionObserver);

		const events: Array<{ target: MediaTarget; event: string }> = [];
		let registry: MediaRegistry | null = null;
		try {
			registry = new MediaRegistry(
				new DocumentRuntimeContext({ documentId: 'document:late-live', frameId: 0 }),
				(target, event) => events.push({ target, event }),
			);
			const coverTarget = registry.list().find(({ element }) => element === cover)?.target;
			expect(coverTarget).toBeDefined();
			expect(registry.resolve(null)?.target).toEqual(coverTarget);

			document.documentElement.descendants.push(live);
			FakeMutationObserver.latest?.emit([live]);

			const liveTarget = registry.list().find(({ element }) => element === live)?.target;
			expect(liveTarget).toBeDefined();
			// No geometry yet: the unseen player must not steal the visit.
			expect(registry.resolve(null)?.target).toEqual(coverTarget);

			// Geometry arrives and this player is now the larger presentation.
			cover.rect = { left: 50, top: 60, right: 250, bottom: 200, width: 200, height: 140 };
			live.rect = { left: 50, top: 60, right: 1_330, bottom: 700, width: 1_280, height: 640 };
			FakeIntersectionObserver.latest?.emit([live, cover]);
			expect(registry.resolve(null)?.target).toEqual(liveTarget);
			expect(events.at(-1)?.target).toEqual(liveTarget);
			expect(events.at(-1)?.event).toBe('selected');
		} finally {
			registry?.dispose();
			restoreGlobalDescriptors(descriptors);
			FakeMutationObserver.latest = null;
		}
	});

	test('hands a silent selection to a broadcast that is already running without a layout box', () => {
		// Douyin mounts the running broadcast before it has a layout box (the page
		// paints frames elsewhere). The previous player is paused and still
		// selected, so no gesture reaches the sound: playback is the remaining
		// proof, and a silent selection has nothing to protect.
		const descriptors = captureGlobalDescriptors([
			'document',
			'Node',
			'Element',
			'HTMLMediaElement',
			'HTMLVideoElement',
			'MutationObserver',
			'IntersectionObserver',
		]);
		const document = new FakeDocument();
		const previous = new FakeVideoElement(1);
		const broadcast = new FakeVideoElement(0, true);
		previous.paused = true;
		previous.duration = 8;
		previous.rect = { left: 0, top: 0, right: 960, bottom: 540, width: 960, height: 540 };
		broadcast.paused = false;
		broadcast.duration = Number.POSITIVE_INFINITY;
		broadcast.rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
		document.documentElement.descendants.push(previous);

		installGlobal('document', document);
		installGlobal('Node', EventTarget);
		installGlobal('Element', FakeElement);
		installGlobal('HTMLMediaElement', FakeMediaElement);
		installGlobal('HTMLVideoElement', FakeVideoElement);
		installGlobal('MutationObserver', FakeMutationObserver);
		installGlobal('IntersectionObserver', FakeIntersectionObserver);

		let registry: MediaRegistry | null = null;
		try {
			registry = new MediaRegistry(
				new DocumentRuntimeContext({ documentId: 'document:running-broadcast', frameId: 0 }),
				() => undefined,
			);
			const previousTarget = registry.list().find(({ element }) => element === previous)?.target;
			expect(registry.resolve(null)?.target).toEqual(previousTarget);

			document.documentElement.descendants.push(broadcast);
			FakeMutationObserver.latest?.emit([broadcast]);

			const broadcastTarget = registry.list().find(({ element }) => element === broadcast)?.target;
			expect(broadcastTarget).toBeDefined();
			expect(registry.resolve(null)?.target).toEqual(broadcastTarget);
		} finally {
			registry?.dispose();
			restoreGlobalDescriptors(descriptors);
			FakeMutationObserver.latest = null;
		}
	});

	test.each(['loadedmetadata', 'loadeddata', 'durationchange', 'live-paused', 'explicit', 'paused', 'pip', 'fullscreen', 'fullscreen-container', 'fullscreen-container-play'] as const)('admits live evidence without overriding a protected selection (%s)', (trigger) => {
		// The finite pre-roll is not the requested broadcast. Its greater area
		// must not keep volume/mute gestures on the ad after live metadata arrives.
		const descriptors = captureGlobalDescriptors([
			'document',
			'Node',
			'Element',
			'HTMLMediaElement',
			'HTMLVideoElement',
			'MutationObserver',
			'IntersectionObserver',
		]);
		const document = new FakeDocument();
		const cover = new FakeVideoElement(1, true);
		const live = new FakeVideoElement(1, true);
		cover.paused = false;
		cover.duration = 8;
		cover.rect = { left: 50, top: 60, right: 1_330, bottom: 640, width: 1_280, height: 580 };
		live.paused = false;
		live.duration = Number.NaN;
		live.rect = { left: 541, top: 927, right: 821, bottom: 1_085, width: 280, height: 158 };
		document.documentElement.descendants.push(cover, live);

		installGlobal('document', document);
		installGlobal('Node', EventTarget);
		installGlobal('Element', FakeElement);
		installGlobal('HTMLMediaElement', FakeMediaElement);
		installGlobal('HTMLVideoElement', FakeVideoElement);
		installGlobal('MutationObserver', FakeMutationObserver);
		installGlobal('IntersectionObserver', FakeIntersectionObserver);

		let registry: MediaRegistry | null = null;
		try {
			registry = new MediaRegistry(
				new DocumentRuntimeContext({ documentId: 'document:live-metadata', frameId: 0 }),
				() => undefined,
			);
			const coverTarget = registry.list().find(({ element }) => element === cover)?.target;
			expect(coverTarget).toBeDefined();
			expect(registry.resolve(null)?.target).toEqual(coverTarget);

			if (trigger === 'explicit') registry.select(requireValue(coverTarget));
			if (trigger === 'paused') registry.pinPaused(requireValue(coverTarget));
			if (trigger === 'pip') document.pictureInPictureElement = cover;
			if (trigger === 'fullscreen') document.fullscreenElement = cover;
			if (trigger.startsWith('fullscreen-container')) document.fullscreenElement = document.documentElement;
			if (trigger === 'loadeddata') {
				live.duration = Number.POSITIVE_INFINITY;
				live.buffered = { length: 0 } as TimeRanges;
				live.dispatchEvent(new Event('loadedmetadata'));
				expect(registry.resolve(null)?.target).toEqual(coverTarget);
				live.buffered = { length: 1 } as TimeRanges;
			}
			live.duration = Number.POSITIVE_INFINITY;
			if (trigger === 'live-paused') live.paused = true;
			const protectedSelection = ['explicit', 'paused', 'pip', 'fullscreen'].includes(trigger);
			live.dispatchEvent(new Event(protectedSelection || trigger === 'fullscreen-container-play' ? 'play'
				: trigger === 'fullscreen-container' || trigger === 'live-paused' ? 'loadedmetadata' : trigger));

			const liveTarget = registry.list().find(({ element }) => element === live)?.target;
			expect(liveTarget).toBeDefined();
			expect(registry.resolve(null)?.target).toEqual(protectedSelection ? coverTarget : liveTarget);
		} finally {
			registry?.dispose();
			restoreGlobalDescriptors(descriptors);
			FakeMutationObserver.latest = null;
		}
	});

	test('keeps a hidden preview from taking the visit when it starts playing later', () => {
		// A clip that is playing with no geometry is still a preview, live or not,
		// and the visible owner keeps the control target.
		const descriptors = captureGlobalDescriptors([
			'document',
			'Node',
			'Element',
			'HTMLMediaElement',
			'HTMLVideoElement',
			'MutationObserver',
			'IntersectionObserver',
		]);
		const document = new FakeDocument();
		const owner = new FakeVideoElement(1);
		const preview = new FakeVideoElement(1);
		owner.paused = false;
		owner.rect = { left: 0, top: 0, right: 960, bottom: 540, width: 960, height: 540 };
		preview.paused = false;
		preview.rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
		document.documentElement.descendants.push(owner);

		installGlobal('document', document);
		installGlobal('Node', EventTarget);
		installGlobal('Element', FakeElement);
		installGlobal('HTMLMediaElement', FakeMediaElement);
		installGlobal('HTMLVideoElement', FakeVideoElement);
		installGlobal('MutationObserver', FakeMutationObserver);
		installGlobal('IntersectionObserver', FakeIntersectionObserver);

		let registry: MediaRegistry | null = null;
		try {
			registry = new MediaRegistry(
				new DocumentRuntimeContext({ documentId: 'document:hidden-preview', frameId: 0 }),
				() => undefined,
			);
			const ownerTarget = registry.list().find(({ element }) => element === owner)?.target;
			expect(registry.resolve(null)?.target).toEqual(ownerTarget);

			document.documentElement.descendants.push(preview);
			FakeMutationObserver.latest?.emit([preview]);
			expect(registry.resolve(null)?.target).toEqual(ownerTarget);
		} finally {
			registry?.dispose();
			restoreGlobalDescriptors(descriptors);
			FakeMutationObserver.latest = null;
		}
	});

	test('selects the live broadcast instead of the larger audible advertisement', () => {
		// A pre-roll's loudness and area do not make it the broadcast control
		// target. A positive volume gesture must reach and unmute the live target.
		const descriptors = captureGlobalDescriptors(['document', 'Element']);
		const document = new FakeDocument();
		installGlobal('document', document);
		installGlobal('Element', FakeElement);
		const area = (element: HTMLMediaElement): number => {
			const rect = (element as unknown as FakeVideoElement).rect;
			return rect.width * rect.height;
		};
		try {
			const ad = new FakeVideoElement(1);
			const stream = new FakeVideoElement(0);
			ad.paused = false;
			stream.paused = false;
			ad.muted = false;
			stream.muted = true;
			ad.rect = { left: 90, top: 628, right: 940, bottom: 1_106, width: 850, height: 478 };
			stream.rect = { left: 703, top: 931, right: 927, bottom: 1_057, width: 224, height: 126 };
			stream.duration = Number.POSITIVE_INFINITY;
			expect(chooseInitialMedia([stream, ad] as unknown as HTMLMediaElement[], 'media', area))
				.toBe(stream);
			// It remains selected when the pre-roll ends and the layout expands.
			stream.rect = { left: 90, top: 628, right: 940, bottom: 1_106, width: 850, height: 478 };
			expect(chooseInitialMedia([stream, ad] as unknown as HTMLMediaElement[], 'media', area))
				.toBe(stream);
		} finally {
			restoreGlobalDescriptors(descriptors);
		}
	});

	test.each(['hidden', 'detached', 'ended'] as const)('returns from a %s modal to an already-playing feed without another play event', async (close) => {
		const descriptors = captureGlobalDescriptors([
			'document', 'Node', 'Element', 'HTMLMediaElement', 'HTMLVideoElement',
			'MutationObserver', 'IntersectionObserver',
		]);
		const document = new FakeDocument();
		const feed = new FakeVideoElement(1);
		const modal = new FakeVideoElement(1);
		feed.paused = false;
		modal.paused = false;
		feed.rect = { left: 0, top: 0, right: 320, bottom: 180, width: 320, height: 180 };
		modal.rect = { left: 0, top: 0, right: 640, bottom: 360, width: 640, height: 360 };
		document.documentElement.descendants.push(feed, modal);
		installGlobal('document', document);
		installGlobal('Node', EventTarget);
		installGlobal('Element', FakeElement);
		installGlobal('HTMLMediaElement', FakeMediaElement);
		installGlobal('HTMLVideoElement', FakeVideoElement);
		installGlobal('MutationObserver', FakeMutationObserver);
		installGlobal('IntersectionObserver', FakeIntersectionObserver);
		const selected: MediaTarget[] = [];
		let registry: MediaRegistry | null = null;
		try {
			registry = new MediaRegistry(
				new DocumentRuntimeContext({ documentId: `document:modal-close-${close}`, frameId: 0 }),
				(target, event) => { if (event === 'selected') selected.push(target); },
			);
			modal.dispatchEvent(new Event('play'));
			expect(registry.resolve(null)?.element).toBe(modal);
			selected.length = 0;
			if (close === 'detached') {
				modal.isConnected = false;
				FakeMutationObserver.latest?.emit([], [modal]);
				await Promise.resolve();
			} else if (close === 'ended') {
				modal.ended = true;
				modal.dispatchEvent(new Event('ended'));
			} else {
				// A visible user-paused player remains controllable. Only the later
				// visibility batch proves that this modal has left the active surface.
				modal.paused = true;
				modal.dispatchEvent(new Event('pause'));
				expect(registry.resolve(null)?.element).toBe(modal);
				expect(selected).toEqual([]);
				modal.rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
				FakeIntersectionObserver.latest?.emit([modal, feed]);
			}
			expect(registry.resolve(null)?.element).toBe(feed);
			expect(selected).toHaveLength(1);
			expect(selected[0]).toEqual(registry.resolve(null)?.target);
			registry.peek(null);
			registry.resolveVideo(null);
			expect(selected).toHaveLength(1);
		} finally {
			registry?.dispose();
			restoreGlobalDescriptors(descriptors);
			FakeMutationObserver.latest = null;
			FakeIntersectionObserver.latest = null;
		}
	});

	test.each(['pip', 'fullscreen', 'audio', 'no-replacement'] as const)('keeps a hidden %s owner until a real replacement is admissible', (owner) => {
		const descriptors = captureGlobalDescriptors([
			'document', 'Node', 'Element', 'HTMLMediaElement', 'HTMLVideoElement',
			'MutationObserver', 'IntersectionObserver',
		]);
		const document = new FakeDocument();
		const feed = new FakeVideoElement(1);
		const selected = owner === 'audio' ? new FakeMediaElement(1) : new FakeVideoElement(1);
		feed.paused = false;
		selected.paused = false;
		feed.rect = { left: 0, top: 0, right: 320, bottom: 180, width: 320, height: 180 };
		selected.rect = { left: 0, top: 0, right: 640, bottom: 360, width: 640, height: 360 };
		document.documentElement.descendants.push(...(owner === 'no-replacement' ? [selected] : [feed, selected]));
		installGlobal('document', document);
		installGlobal('Node', EventTarget);
		installGlobal('Element', FakeElement);
		installGlobal('HTMLMediaElement', FakeMediaElement);
		installGlobal('HTMLVideoElement', FakeVideoElement);
		installGlobal('MutationObserver', FakeMutationObserver);
		installGlobal('IntersectionObserver', FakeIntersectionObserver);
		let registry: MediaRegistry | null = null;
		try {
			registry = new MediaRegistry(new DocumentRuntimeContext({ documentId: `document:protected-${owner}`, frameId: 0 }));
			const target = requireValue(registry.list().find(({ element }) => element === selected)?.target, 'Expected selected media');
			expect(registry.select(target)).toBe(true);
			if (owner === 'pip') document.pictureInPictureElement = selected;
			if (owner === 'fullscreen') document.fullscreenElement = selected;
			selected.rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
			FakeIntersectionObserver.latest?.emit([selected]);
			expect(registry.resolve(null)?.element).toBe(selected);
			if (owner === 'pip' || owner === 'fullscreen') {
				document.pictureInPictureElement = null;
				document.fullscreenElement = null;
				if (owner === 'pip') selected.dispatchEvent(new Event('leavepictureinpicture'));
				else {
					// The fullscreen listener remembers the actual entering owner.
					document.fullscreenElement = selected;
					document.dispatchEvent(new Event('fullscreenchange'));
					document.fullscreenElement = null;
					document.dispatchEvent(new Event('fullscreenchange'));
				}
				expect(registry.resolve(null)?.element).toBe(feed);
			}
		} finally {
			registry?.dispose();
			restoreGlobalDescriptors(descriptors);
			FakeMutationObserver.latest = null;
			FakeIntersectionObserver.latest = null;
		}
	});

	test('keeps reads pure, separates active media/video, and versions every logical source epoch', async () => {
		const descriptors = captureGlobalDescriptors([
			'document',
			'Node',
			'Element',
			'HTMLMediaElement',
			'HTMLVideoElement',
			'MutationObserver',
			'IntersectionObserver',
		]);
		const document = new FakeDocument();
		const audio = new FakeMediaElement(0.8);
		const video = new FakeVideoElement(0.9);
		audio.currentSrc = 'https://media.example/reused.mp3';
		video.currentSrc = 'https://media.example/video.mp4';
		document.documentElement.descendants.push(audio, video);

		installGlobal('document', document);
		installGlobal('Node', EventTarget);
		installGlobal('Element', FakeElement);
		installGlobal('HTMLMediaElement', FakeMediaElement);
		installGlobal('HTMLVideoElement', FakeVideoElement);
		installGlobal('MutationObserver', FakeMutationObserver);
		installGlobal('IntersectionObserver', FakeIntersectionObserver);

		const events: Array<{ target: MediaTarget; event: string }> = [];
		let registry: MediaRegistry | null = null;
		try {
			registry = new MediaRegistry(
				new DocumentRuntimeContext({ documentId: 'document:registry', frameId: 0 }),
				(eventTarget, event) => {
					events.push({ target: eventTarget, event });
				},
			);
			const audioTarget = requireValue(
				registry.list().find(({ element }) => element === audio)?.target,
				'Expected the registry to assign an identity to the audio fixture',
			);
			const videoTarget = requireValue(
				registry.list().find(({ element }) => element === video)?.target,
				'Expected the registry to assign an identity to the video fixture',
			);
			expect(audioTarget).toBeDefined();
			expect(videoTarget).toBeDefined();

			// After discovery admission, explicit selection writes the chosen target. Reads of either identity
			// cannot steal the other target or emit a selected event.
			expect(registry.select(videoTarget)).toBe(true);
			expect(registry.select(audioTarget)).toBe(true);
			const selectedBeforeReads = events.filter(({ event }) => event === 'selected').length;
			expect(registry.peek(videoTarget)?.target).toEqual(videoTarget);
			expect(registry.resolve(null)?.target).toEqual(audioTarget);
			expect(registry.resolveVideo(null)?.target).toEqual(videoTarget);
			expect(events.filter(({ event }) => event === 'selected')).toHaveLength(selectedBeforeReads);

			// A page-owned fullscreen container is attributed to its contained active
			// video even when the independently active media target is audio.
			document.fullscreenElement = document.documentElement;
			document.dispatchEvent(new Event('fullscreenchange'));
			expect(events.filter(({ event }) => event === 'fullscreenchange').at(-1)?.target)
				.toEqual(videoTarget);

			// `emptied + loadstart` is one same-URL load epoch; loadedmetadata closes
			// it so the next explicit load can advance the source revision again.
			audio.dispatchEvent(new Event('emptied'));
			audio.dispatchEvent(new Event('loadstart'));
			audio.dispatchEvent(new Event('loadedmetadata'));
			let currentAudioTarget = registry.list().find(({ element }) => element === audio)?.target;
			expect(currentAudioTarget).toMatchObject({
				mediaId: audioTarget?.mediaId,
				sourceRevision: 1,
			});

			const firstStream = {};
			audio.srcObject = firstStream;
			audio.dispatchEvent(new Event('loadstart'));
			audio.dispatchEvent(new Event('loadedmetadata'));
			const secondStream = {};
			audio.srcObject = secondStream;
			audio.dispatchEvent(new Event('loadstart'));
			audio.dispatchEvent(new Event('loadedmetadata'));
			currentAudioTarget = registry.list().find(({ element }) => element === audio)?.target;
			expect(currentAudioTarget).toMatchObject({
				mediaId: audioTarget.mediaId,
				sourceRevision: 3,
			});
			// A target captured before a stream change still addresses the same
			// control target: only its resource revision is stale (SP-22.3 §1).
			expect(registry.resolve(audioTarget)?.element).toBe(audio);
			expect(registry.resolve(audioTarget)?.target.sourceRevision).toBe(3);

			// A framework reparent commonly appears as remove+add in one observer
			// batch. Deferring detach to a microtask preserves identity and revision.
			FakeMutationObserver.latest?.emit([audio], [audio]);
			await Promise.resolve();
			expect(registry.list().find(({ element }) => element === audio)?.target)
				.toEqual(currentAudioTarget);
		} finally {
			registry?.dispose();
			restoreGlobalDescriptors(descriptors);
			FakeMutationObserver.latest = null;
		}
	});

	test('preserves native media fields while tracking source-scoped video ownership', async () => {
		const descriptors = captureGlobalDescriptors([
			'document',
			'window',
			'Node',
			'Element',
			'HTMLMediaElement',
			'HTMLVideoElement',
			'MutationObserver',
			'IntersectionObserver',
		]);
		const document = new FakeDocument();
		const window = { innerWidth: 1_280, innerHeight: 720 };
		const first = new FakeMediaElement(0.7);
		const second = new FakeMediaElement(0.9);
		second.currentSrc = 'https://media.example/one.mp4';
		document.documentElement.descendants.push(first);

		installGlobal('document', document);
		installGlobal('window', window);
		installGlobal('Node', EventTarget);
		installGlobal('Element', FakeElement);
		installGlobal('HTMLMediaElement', FakeMediaElement);
		installGlobal('HTMLVideoElement', FakeVideoElement);
		installGlobal('MutationObserver', FakeMutationObserver);
		installGlobal('IntersectionObserver', FakeIntersectionObserver);

		let disposeActiveRegistry = () => undefined;
		let disposeABSourceObserver = () => undefined;
		let disposeMarkerSourceObserver = () => undefined;
		const releasedABTargets: MediaTarget[] = [];
		const registryEvents: Array<{ target: MediaTarget; event: string }> = [];
		let mediaRegistry: MediaRegistry | null = null;
		try {
			mediaRegistry = new MediaRegistry(
				new DocumentRuntimeContext({ documentId: 'document:observer', frameId: 0 }),
				(target, event) => {
					registryEvents.push({ target, event });
				},
			);
			disposeActiveRegistry = setActiveMediaRegistry(mediaRegistry);
			disposeABSourceObserver = observeABLoopSources(
				mediaRegistry,
				(target) => releasedABTargets.push(target),
			);
			disposeMarkerSourceObserver = observeMarkerSources(mediaRegistry);
			expect(mediaRegistry.size).toBe(1);
			expect(isAnyMediaPlaying()).toBe(false);
			expect(first.volume).toBe(0.7);
			expect(first.playbackRate).toBe(1);

			FakeMutationObserver.latest?.emit([second]);
			expect(second.volume).toBe(0.9);
			expect(second.playbackRate).toBe(1);
			expect(mediaRegistry.size).toBe(2);
			const secondTarget = mediaRegistry.list().find(({ element }) => element === second)?.target;
			expect(secondTarget).toBeDefined();
			mediaRegistry.select(secondTarget ?? null);
			expect(registryEvents.filter(({ event }) => event === 'selected')).toEqual([{
				target: secondTarget,
				event: 'selected',
			}]);
			second.paused = false;
			expect(isAnyMediaPlaying()).toBe(true);
			expect(setPointA()).toBe(0);
			second.currentTime = 1;
			expect(setPointB()).toEqual({ pointB: 1, looping: true });
			expect(addMarker()).not.toBeNull();
			expect(abLoopTestApi.sourceCount()).toBe(1);
			expect(timeMarkerTestApi.sourceCount()).toBe(1);

			// Let the initial boundary seek settle before retiring the source so the
			// test observes the registry disposal path, not an in-flight seek failure.
			await Promise.resolve();
			second.currentSrc = 'https://media.example/two.mp4';
			FakeMutationObserver.latest?.emitAttribute(second, 'src');
			const replacedTarget = mediaRegistry.list().find(({ element }) => element === second)?.target;
			expect(replacedTarget).toMatchObject({
				mediaId: secondTarget?.mediaId,
				sourceRevision: 1,
			});
			expect(registryEvents.filter(({ event }) => event === 'selected').at(-1)?.target)
				.toMatchObject({ mediaId: secondTarget?.mediaId, sourceRevision: 1 });
			expect(abLoopTestApi.sourceCount()).toBe(0);
			expect(timeMarkerTestApi.sourceCount()).toBe(0);
			expect(releasedABTargets).toEqual([]);
			expect(second.listenerCount('play')).toBe(1);

			second.volume = 0.2;
			second.playbackRate = 1;
			second.dispatchEvent(new Event('loadedmetadata'));
			expect(second.volume).toBe(0.2);
			expect(second.playbackRate).toBe(1);

			FakeMutationObserver.latest?.emit([], [second]);
			await Promise.resolve();
			expect(mediaRegistry.list().some(({ element }) => element === second)).toBe(true);

			second.isConnected = false;
			FakeMutationObserver.latest?.emit([], [second]);
			await Promise.resolve();
			expect(mediaRegistry.list().some(({ element }) => element === second)).toBe(false);
			expect(second.volume).toBe(0.2);
			expect(second.playbackRate).toBe(1);

			second.isConnected = true;
			FakeMutationObserver.latest?.emit([second]);
			expect(mediaRegistry.list().some(({ element }) => element === second)).toBe(true);
			expect(second.volume).toBe(0.2);
			expect(second.playbackRate).toBe(1);
		} finally {
			disposeABSourceObserver();
			disposeMarkerSourceObserver();
			disposeABLoops();
			disposeMarkers();
			disposeActiveRegistry();
			mediaRegistry?.dispose();
			restoreGlobalDescriptors(descriptors);
			FakeMutationObserver.latest = null;
		}
	});
});

function installGlobal(key: string, value: unknown): void {
	Object.defineProperty(globalThis, key, { configurable: true, value });
}

function captureGlobalDescriptors(keys: string[]): Map<string, PropertyDescriptor | undefined> {
	return new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
}

function restoreGlobalDescriptors(descriptors: Map<string, PropertyDescriptor | undefined>): void {
	for (const [key, descriptor] of descriptors) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else Reflect.deleteProperty(globalThis, key);
	}
}
