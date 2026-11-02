import { describe, expect, mock, test } from 'bun:test';
import { requireValue } from './helpers/require-value';
import type { MediaTarget } from '@nexus/contracts';
import {
	MediaRegistry,
	chooseInitialMedia,
	setActiveMediaRegistry,
} from '../src/content/core/media-registry';
import { DocumentRuntimeContext } from '../src/content/core/content-runtime-context';
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
		const first = new MediaRegistry(context); const second = new MediaRegistry(context);
		try {
			expect(first.captureObservation().owner).toBe('document:owner-replacement:8');
			expect(second.captureObservation().owner).toBe('document:owner-replacement:9');
			expect(first.captureObservation().epoch).toBe(8); expect(second.captureObservation().epoch).toBe(9);
		} finally { first.dispose(); second.dispose(); restoreGlobalDescriptors(descriptors); }
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
			expect(registry.resolve(audioTarget)).toBeNull();

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
