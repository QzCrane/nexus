// goal: prove the declared-official route is attributable and that a stale UI
// projection becomes visible drift instead of an invisible divergence
//
// The unit under test is the executor's routing, not the MAIN bridge: the stub
// below answers exactly what a declared adapter's bridge replies — an `actual`
// from the controller getter plus a `projection` from the badge — so the two
// channels can be made to disagree on purpose.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ControlApplyAck, ControlWriteState, MediaTarget } from '@nexus/contracts';
import type { MediaRegistry, MediaRegistryEvent } from '../src/content/core/media-registry';
import { NativeMediaExecutor } from '../src/content/logic/native-media-executor';
import {
	resetNativeWritePolicy,
	resolveNativeWriteMode,
	snapshotNativeWritePolicy,
} from '../src/content/logic/native-write-policy';
import type { VideoEffectsController } from '../src/content/video/video-effects-controller';
import {
	SPECTRA_PAGE_MEDIA_EVENT,
	SPECTRA_PAGE_MEDIA_REQUEST_ATTRIBUTE,
	SPECTRA_PAGE_MEDIA_RESULT_ATTRIBUTE,
	type SpectraPageMediaRequest,
	type SpectraPageMediaResult,
} from '../src/shared/page-media-bridge';

type RegistryListener = (
	target: MediaTarget,
	event: MediaRegistryEvent,
	element: HTMLMediaElement,
) => void;

class BridgedElement extends EventTarget {
	playbackRate = 1;
	defaultPlaybackRate = 1;
	volume = 1;
	muted = false;
	paused = true;
	currentTime = 0;
	loop = false;
	preservesPitch = true;
	private readonly attributes = new Map<string, string>();

	setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
	getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
	removeAttribute(name: string): void { this.attributes.delete(name); }
}

class FakeRegistry {
	listener: RegistryListener | null = null;
	readonly element = new BridgedElement();
	readonly target: MediaTarget = {
		frameId: 0,
		documentId: 'document-douyin',
		mediaId: 'media:douyin',
		sourceRevision: 0,
		kind: 'video',
	};

	get documentId(): string { return this.target.documentId; }

	subscribe(listener: RegistryListener): () => void {
		this.listener = listener;
		return () => { this.listener = null; };
	}

	resolve(): { element: HTMLMediaElement; target: MediaTarget } {
		return {
			element: this.element as unknown as HTMLMediaElement,
			target: { ...this.target },
		};
	}

	list(): Array<{ element: HTMLMediaElement; target: MediaTarget }> {
		return [this.resolve()];
	}

	emit(event: MediaRegistryEvent): void {
		this.listener?.(
			{ ...this.target },
			event,
			this.element as unknown as HTMLMediaElement,
		);
	}
}

interface DeclaredAdapterState {
	/** What the site's own controller reports. */
	speed: number;
	/** What the player's badge renders — deliberately allowed to fall behind. */
	badge: number;
	/** The adapter the bridge would name; null models generic discovery. */
	adapterId: string | null;
	/** When false, the badge stops following the setter (the Douyin shape). */
	badgeFollowsWrite: boolean;
	writes: number[];
}

function installDeclaredBridge(
	media: BridgedElement,
	state: DeclaredAdapterState,
): void {
	media.addEventListener(SPECTRA_PAGE_MEDIA_EVENT, () => {
		const request = JSON.parse(
			media.getAttribute(SPECTRA_PAGE_MEDIA_REQUEST_ATTRIBUTE) ?? '{}',
		) as Partial<SpectraPageMediaRequest>;
		if (!request.requestId || !request.field || !request.operation) return;
		if (request.operation === 'write' && request.field === 'speed' && typeof request.value === 'number') {
			state.writes.push(request.value);
			state.speed = request.value;
			media.playbackRate = request.value;
			// A declared adapter's whole reason to exist: the setter the site's own
			// UI calls is the one that renders the badge.
			if (state.badgeFollowsWrite) state.badge = request.value;
		}
		const result: SpectraPageMediaResult = {
			requestId: request.requestId,
			field: request.field,
			supported: true,
			actual: state.speed,
			...(state.adapterId ? { adapterId: state.adapterId } : {}),
			projection: state.badge,
		};
		media.setAttribute(SPECTRA_PAGE_MEDIA_RESULT_ATTRIBUTE, JSON.stringify(result));
	});
}

function speedAck(result: ControlApplyAck): {
	state: ControlWriteState | undefined;
	code: string | undefined;
	actual: unknown;
} {
	const field = (result.fields as Record<string, { writeState?: ControlWriteState; lastError?: { code: string }; actual?: unknown }>).speed;
	return { state: field?.writeState, code: field?.lastError?.code, actual: field?.actual };
}

const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
const originalMedia = Object.getOwnPropertyDescriptor(globalThis, 'HTMLMediaElement');
const originalVideo = Object.getOwnPropertyDescriptor(globalThis, 'HTMLVideoElement');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
const originalRaf = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');

function restore(key: string, descriptor?: PropertyDescriptor): void {
	if (descriptor) Object.defineProperty(globalThis, key, descriptor);
	else Reflect.deleteProperty(globalThis, key);
}

function installEnvironment(hostname: string): void {
	Object.defineProperty(globalThis, 'chrome', {
		configurable: true,
		value: { runtime: { sendMessage: () => Promise.resolve({ ok: true }) } },
	});
	Object.defineProperty(globalThis, 'HTMLMediaElement', { configurable: true, value: BridgedElement });
	Object.defineProperty(globalThis, 'HTMLVideoElement', {
		configurable: true,
		value: class extends BridgedElement { },
	});
	Object.defineProperty(globalThis, 'document', {
		configurable: true,
		value: { pictureInPictureElement: null, fullscreenElement: null },
	});
	Object.defineProperty(globalThis, 'location', { configurable: true, value: { hostname } });
	Object.defineProperty(globalThis, 'requestAnimationFrame', {
		configurable: true,
		value: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0),
	});
}

async function applySpeed(registry: FakeRegistry, executor: NativeMediaExecutor, speed: number): Promise<ControlApplyAck> {
	return executor.execute({
		intentId: `intent:speed:${speed}`,
		tabId: 3,
		documentId: registry.target.documentId,
		generation: 1,
		baseRevision: 1,
		source: 'popup',
		requestedCoverage: 'active-target',
		target: registry.target,
		actualContext: {},
		patch: { speed },
	});
}

function newExecutor(registry: FakeRegistry): NativeMediaExecutor {
	const effects = { dispose: () => undefined } as unknown as VideoEffectsController;
	return new NativeMediaExecutor(registry as unknown as MediaRegistry, effects);
}

beforeEach(() => {
	resetNativeWritePolicy();
});

afterEach(() => {
	restore('chrome', originalChrome);
	restore('HTMLMediaElement', originalMedia);
	restore('HTMLVideoElement', originalVideo);
	restore('document', originalDocument);
	restore('location', originalLocation);
	restore('requestAnimationFrame', originalRaf);
	resetNativeWritePolicy();
});

describe('declared official adapter routing', () => {
	test('a declared answer is written through the page and its badge is recorded as confirmed', async () => {
		installEnvironment('www.douyin.com');
		const registry = new FakeRegistry();
		const state: DeclaredAdapterState = {
			speed: 1,
			badge: 1,
			adapterId: 'douyin-speed',
			badgeFollowsWrite: true,
			writes: [],
		};
		installDeclaredBridge(registry.element, state);
		const executor = newExecutor(registry);
		try {
			const result = await applySpeed(registry, executor, 1.5);
			expect(result.fields.speed).toMatchObject({
				phase: 'applied',
				// The wire contract has no declared value; it reports the page route.
				strategy: 'page-native',
				actual: 1.5,
			});
			expect(state.writes).toEqual([1.5]);
			// The audit ran because the answer was attributable to a declared row.
			expect(snapshotNativeWritePolicy().sites).toEqual([
				{ siteKey: 'www.douyin.com', mode: 'optimistic', drifts: 0 },
			]);
		} finally {
			executor.dispose();
		}
	}, 10_000);

	test('a badge that never follows the setter is recorded as drift, not hidden', async () => {
		installEnvironment('www.douyin.com');
		const registry = new FakeRegistry();
		const state: DeclaredAdapterState = {
			speed: 1,
			badge: 1,
			adapterId: 'douyin-speed',
			// The exact Douyin failure: the rate moves, the label does not.
			badgeFollowsWrite: false,
			writes: [],
		};
		installDeclaredBridge(registry.element, state);
		const executor = newExecutor(registry);
		try {
			const result = await applySpeed(registry, executor, 1.5);
			// The write itself is honoured: the rate is right, so failing the
			// control action would be a lie in the other direction.
			expect(speedAck(result).actual).toBe(1.5);
			expect(state.writes).toEqual([1.5]);
			await new Promise((resolve) => { setTimeout(resolve, 400); });
			expect(snapshotNativeWritePolicy().sites).toEqual([
				{ siteKey: 'www.douyin.com', mode: 'optimistic', drifts: 1 },
			]);
		} finally {
			executor.dispose();
		}
	}, 10_000);

	test('a site whose badge keeps disagreeing is demoted to the verified path', async () => {
		installEnvironment('www.douyin.com');
		const registry = new FakeRegistry();
		const state: DeclaredAdapterState = {
			speed: 1,
			badge: 1,
			adapterId: 'douyin-speed',
			badgeFollowsWrite: false,
			writes: [],
		};
		installDeclaredBridge(registry.element, state);
		const executor = newExecutor(registry);
		try {
			await applySpeed(registry, executor, 1.25);
			await new Promise((resolve) => { setTimeout(resolve, 400); });
			await applySpeed(registry, executor, 1.75);
			await new Promise((resolve) => { setTimeout(resolve, 400); });
			expect(snapshotNativeWritePolicy().sites[0]?.drifts).toBe(2);
			expect(resolveNativeWriteMode('www.douyin.com')).toBe('verified');
		} finally {
			executor.dispose();
		}
	}, 15_000);

	test('generic discovery stays unaudited and leaves the ledger untouched', async () => {
		installEnvironment('example.com');
		const registry = new FakeRegistry();
		const state: DeclaredAdapterState = {
			speed: 1,
			badge: 1,
			// No declared row matched, so the bridge names no adapter.
			adapterId: null,
			badgeFollowsWrite: true,
			writes: [],
		};
		installDeclaredBridge(registry.element, state);
		const executor = newExecutor(registry);
		try {
			const result = await applySpeed(registry, executor, 2);
			expect(result.fields.speed).toMatchObject({ phase: 'applied', actual: 2 });
			expect(state.writes).toEqual([2]);
			// Nothing to witness through a declared projection, so nothing is
			// recorded — the audit must not invent evidence for generic routes.
			expect(snapshotNativeWritePolicy().sites).toEqual([]);
		} finally {
			executor.dispose();
		}
	}, 10_000);
});
