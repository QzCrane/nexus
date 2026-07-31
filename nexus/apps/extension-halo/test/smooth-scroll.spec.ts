import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	spyOn,
	test,
} from 'bun:test';
import {
	clearQueue,
	COARSE_SCROLL_LIMITS,
	configure,
	maxBacklogPx,
	scrollTo,
	SCROLL_LIMITS,
	tailBudgetMs,
} from '../src/tools/smooth-scroll/engine';
import {
	acceleration,
	resetRuntimeState,
	state,
	updateStateSettings,
} from '../src/content/smooth-scroll-state';
import {
	canAnimateTarget,
	canScrollBy,
	MAX_SCROLL_ROUTE_ELEMENTS,
	resolveDirectScrollRoute,
	resolveScrollRoute,
	shouldYieldWheel,
} from '../src/tools/smooth-scroll/utils';
import { DEFAULT_SETTINGS, normalizeScrollSettings } from '../src/tools/smooth-scroll/types';

interface FakeStyle {
	overflowX: string;
	overflowY: string;
	overscrollBehaviorY: string;
	overscrollBehavior: string;
	position: string;
}

let closestCalls = 0;
let matchesCalls = 0;

class FakeElement {
	public parentElement: FakeElement | null = null;
	public scrollHeight = 0;
	public clientHeight = 0;
	public clientWidth = 0;
	public scrollTop = 0;
	public scrollLeft = 0;
	public isConnected = true;
	public isContentEditable = false;
	public assignedSlot: FakeElement | null = null;
	public shadowRoot: { activeElement: FakeElement | null } | null = null;
	public readonly attributes = new Map<string, string>();
	public readonly style = { cursor: '' };
	public readonly styleState: FakeStyle = {
		overflowX: 'visible',
		overflowY: 'visible',
		overscrollBehaviorY: 'auto',
		overscrollBehavior: 'auto',
		position: 'static',
	};

	public constructor(
		public readonly tagName: string,
		public rectHeight = 0,
	) {}

	public getAttribute(name: string): string | null {
		return this.attributes.get(name) ?? null;
	}

	public getRootNode(): unknown {
		return document;
	}

	public hasAttribute(name: string): boolean {
		return this.attributes.has(name);
	}

	public matches(selector: string): boolean {
		matchesCalls++;
		return selector.split(',').some((candidate) => {
			const match = /^([a-z]+)?(?:\[([a-z-]+)(?:="([^"]+)")?\])?$/
				.exec(candidate.trim());
			if (!match) return false;
			const [, tagName, attribute, expectedValue] = match;
			if (tagName && this.tagName !== tagName.toUpperCase()) return false;
			if (!attribute) return Boolean(tagName);
			const actualValue = this.getAttribute(attribute);
			if (expectedValue === undefined) return actualValue !== null;
			return actualValue?.toLowerCase() === expectedValue.toLowerCase();
		});
	}

	public closest(selector: string): FakeElement | null {
		closestCalls++;
		let current: FakeElement | null = this;
		while (current) {
			if (current.matches(selector)) return current;
			current = current.parentElement;
		}
		return null;
	}

	public contains(candidate: FakeElement): boolean {
		let current: FakeElement | null = candidate;
		while (current) {
			if (current === this) return true;
			current = current.parentElement;
		}
		return false;
	}

	public getBoundingClientRect(): { height: number } {
		return { height: this.rectHeight };
	}
}

const reducedMotionMediaQuery = { matches: false };
let fakeNow = 1_000;

class FakeWindow {
	public innerHeight = 900;
	public innerWidth = 1440;
	public scrollY = 0;
	public top: FakeWindow = this;
	public lastScrollBehavior: ScrollBehavior | undefined;
	private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

	public scrollBy(xOrOptions: number | ScrollToOptions, y = 0): void {
		if (typeof xOrOptions === 'number') {
			this.scrollY += y;
			return;
		}
		this.lastScrollBehavior = xOrOptions.behavior;
		this.scrollY += xOrOptions.top ?? 0;
	}

	public matchMedia(): { matches: boolean } {
		return reducedMotionMediaQuery;
	}

	public addEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject,
	): void {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	public removeEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject,
	): void {
		this.listeners.get(type)?.delete(listener);
	}

	public dispatch(type: string, event: Event): void {
		for (const listener of this.listeners.get(type) ?? []) {
			if (typeof listener === 'function') listener(event);
			else listener.handleEvent(event);
		}
	}
}

class FakeWheelEvent {
	public defaultPrevented = false;
	public readonly cancelable = true;
	public readonly ctrlKey = false;
	public readonly deltaMode = 0;
	public propagationStopped = false;
	public composedPathCalls = 0;

	public constructor(
		public readonly target: FakeElement,
		public readonly deltaY: number,
		public readonly timeStamp = fakeNow,
		private readonly suppliedPath?: readonly FakeElement[],
		public readonly isTrusted = true,
		public readonly deltaX = 0,
	) {}

	public composedPath(): EventTarget[] {
		this.composedPathCalls++;
		if (this.suppliedPath) {
			return [...this.suppliedPath] as unknown as EventTarget[];
		}
		const path: FakeElement[] = [];
		let current: FakeElement | null = this.target;
		while (current) {
			path.push(current);
			current = current.parentElement;
		}
		return path as unknown as EventTarget[];
	}

	public preventDefault(): void {
		this.defaultPrevented = true;
	}

	public stopPropagation(): void {
		this.propagationStopped = true;
	}
}

const originalDescriptors = new Map<string, PropertyDescriptor | undefined>();
const frameCallbacks = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
let body: FakeElement;
let root: FakeElement;
let fakeWindow: FakeWindow;
let computedStyleReads = 0;
let onWheel: typeof import('../src/content/smooth-scroll-handlers').onWheel;
let onKeydown: typeof import('../src/content/smooth-scroll-handlers').onKeydown;
let onMouseDown: typeof import('../src/content/smooth-scroll-handlers').onMouseDown;
let onMouseMove: typeof import('../src/content/smooth-scroll-handlers').onMouseMove;
let resetInputHandlers: typeof import('../src/content/smooth-scroll-handlers').resetInputHandlers;

function replaceGlobal(name: string, value: unknown): void {
	if (!originalDescriptors.has(name)) {
		originalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
	}
	Object.defineProperty(globalThis, name, {
		configurable: true,
		writable: true,
		value,
	});
}

function restoreGlobals(): void {
	for (const [name, descriptor] of originalDescriptors) {
		if (descriptor) Object.defineProperty(globalThis, name, descriptor);
		else Reflect.deleteProperty(globalThis, name);
	}
}

function runFrame(timestamp: number): void {
	fakeNow = timestamp;
	const callbacks = [...frameCallbacks.values()];
	frameCallbacks.clear();
	for (const callback of callbacks) callback(timestamp);
}

function runUntilIdle(afterTimestamp: number, maxFrames = 200): void {
	let timestamp = afterTimestamp;
	for (let frame = 0; frame < maxFrames; frame++) {
		if (frameCallbacks.size === 0) return;
		timestamp += 16;
		runFrame(timestamp);
	}
	throw new Error(`Smooth scroll did not settle within ${maxFrames} frames`);
}

function runUntilIdleAtInterval(
	afterTimestamp: number,
	frameInterval: number,
	maxFrames = 500,
): number {
	let timestamp = afterTimestamp;
	for (let frame = 0; frame < maxFrames; frame++) {
		if (frameCallbacks.size === 0) return timestamp;
		timestamp += frameInterval;
		runFrame(timestamp);
	}
	throw new Error(`Smooth scroll did not settle within ${maxFrames} frames`);
}

function element(
	tagName: string,
	parent: FakeElement | null = null,
	options: Partial<{
		scrollHeight: number;
		clientHeight: number;
		overflowY: string;
		overscrollBehaviorY: string;
		position: string;
		rectHeight: number;
	}> = {},
): FakeElement {
	const result = new FakeElement(tagName, options.rectHeight ?? 0);
	result.parentElement = parent;
	result.scrollHeight = options.scrollHeight ?? 0;
	result.clientHeight = options.clientHeight ?? 0;
	result.styleState.overflowY = options.overflowY ?? 'visible';
	result.styleState.overscrollBehaviorY = options.overscrollBehaviorY ?? 'auto';
	result.styleState.position = options.position ?? 'static';
	return result;
}

interface CoarseStreamResult {
	finalPosition: number;
	firstWriteLatencyMs: number;
	lostDistance: number;
	positionAtLastInput: number;
	settleTailMs: number;
	maxFrameMovement: number;
	p95FrameMovement: number;
	p99FrameMovement: number;
	p95VelocityDelta: number;
	p99VelocityDelta: number;
	p95Jerk: number;
	p99Jerk: number;
	maxFrameOwners: number;
	maxWritesPerFrame: number;
	overshootDistance: number;
	preventedEvents: number;
}

interface FineOverloadResult {
	finalPosition: number;
	maxFrameMovement: number;
	settleTailMs: number;
}

interface ReferenceWorkloadResult {
	finalPosition: number;
	firstWriteLatencyMs: number;
	lostDistance: number;
	maxFrameMovement: number;
	p95FrameMovement: number;
	p99FrameMovement: number;
	p95VelocityDelta: number;
	p99VelocityDelta: number;
	p95Jerk: number;
	p99Jerk: number;
	overshootDistance: number;
	settleTailMs: number;
}

interface MotionFrame {
	duration: number;
	movement: number;
	time: number;
}

function percentile(values: readonly number[], fraction: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil(sorted.length * fraction) - 1),
	);
	return sorted[index] ?? 0;
}

function summarizeMotion(
	frames: readonly MotionFrame[],
	firstInputAt: number,
	expectedDistance: number,
	finalPosition: number,
): Omit<
	ReferenceWorkloadResult,
	'finalPosition' | 'maxFrameMovement' | 'settleTailMs'
> & { maxFrameMovement: number } {
	const movements = frames
		.map(({ movement }) => Math.abs(movement))
		.filter((movement) => movement > 0.001);
	const firstWrite = frames.find(({ movement }) => Math.abs(movement) >= 0.5);
	const velocities = frames.map(({ duration, movement }) =>
		duration > 0 ? movement / duration : 0,
	);
	const velocityDeltas: number[] = [];
	const accelerations: number[] = [];
	const accelerationDurations: number[] = [];
	for (let index = 1; index < velocities.length; index++) {
		const current = velocities[index] ?? 0;
		const previous = velocities[index - 1] ?? 0;
		const currentDuration = frames[index]?.duration ?? 0;
		const previousDuration = frames[index - 1]?.duration ?? 0;
		const midpointDuration = (currentDuration + previousDuration) / 2;
		const delta = current - previous;
		velocityDeltas.push(Math.abs(delta));
		accelerations.push(midpointDuration > 0 ? delta / midpointDuration : 0);
		accelerationDurations.push(midpointDuration);
	}
	const jerks: number[] = [];
	for (let index = 1; index < accelerations.length; index++) {
		const current = accelerations[index] ?? 0;
		const previous = accelerations[index - 1] ?? 0;
		const duration =
			((accelerationDurations[index] ?? 0) +
				(accelerationDurations[index - 1] ?? 0)) /
			2;
		jerks.push(duration > 0 ? Math.abs(current - previous) / duration : 0);
	}
	return {
		firstWriteLatencyMs: firstWrite
			? firstWrite.time - firstInputAt
			: Number.POSITIVE_INFINITY,
		lostDistance: Math.max(0, expectedDistance - finalPosition),
		maxFrameMovement: Math.max(0, ...movements),
		overshootDistance: Math.max(0, finalPosition - expectedDistance),
		p95FrameMovement: percentile(movements, 0.95),
		p99FrameMovement: percentile(movements, 0.99),
		p95VelocityDelta: percentile(velocityDeltas, 0.95),
		p99VelocityDelta: percentile(velocityDeltas, 0.99),
		p95Jerk: percentile(jerks, 0.95),
		p99Jerk: percentile(jerks, 0.99),
	};
}

function runCoarseStream(
	frameIntervals: readonly number[],
): CoarseStreamResult {
	clearQueue();
	resetRuntimeState();
	updateStateSettings(DEFAULT_SETTINGS);
	configure(
		DEFAULT_SETTINGS.animationTime,
		DEFAULT_SETTINGS.easing,
		DEFAULT_SETTINGS.pulseScale,
	);
	frameCallbacks.clear();
	const target = element('DIV', null, {
		scrollHeight: 20_000,
		clientHeight: 500,
		overflowY: 'auto',
	});
	let scrollTop = 0;
	let writes = 0;
	Object.defineProperty(target, 'scrollTop', {
		configurable: true,
		get: () => scrollTop,
		set: (value: number) => {
			writes++;
			scrollTop = value;
		},
	});

	const start = 10_000;
	const lastInput = start + 400;
	let intervalIndex = 0;
	const nextInterval = (): number =>
		frameIntervals[Math.min(intervalIndex++, frameIntervals.length - 1)] ?? 16;
	let nextFrame = start + nextInterval();
	let lastFrame = start;
	let maxFrameMovement = 0;
	let maxFrameOwners = 0;
	let maxWritesPerFrame = 0;
	let preventedEvents = 0;
	const motionFrames: MotionFrame[] = [];

	const runTrackedFrame = (): void => {
		const beforePosition = scrollTop;
		const beforeWrites = writes;
		const frameDuration = nextFrame - lastFrame;
		runFrame(nextFrame);
		const movement = scrollTop - beforePosition;
		motionFrames.push({
			duration: frameDuration,
			movement,
			time: nextFrame,
		});
		lastFrame = nextFrame;
		maxFrameMovement = Math.max(
			maxFrameMovement,
			Math.abs(movement),
		);
		maxWritesPerFrame = Math.max(
			maxWritesPerFrame,
			writes - beforeWrites,
		);
		maxFrameOwners = Math.max(maxFrameOwners, frameCallbacks.size);
		nextFrame += nextInterval();
	};

	for (let tick = 0; tick < 11; tick++) {
		const eventTime = start + tick * 40;
		while (nextFrame < eventTime - 0.001) runTrackedFrame();
		fakeNow = eventTime;
		const event = new FakeWheelEvent(target, 120, eventTime);
		onWheel(event as unknown as WheelEvent);
		if (event.defaultPrevented) preventedEvents++;
		maxFrameOwners = Math.max(maxFrameOwners, frameCallbacks.size);
		if (Math.abs(nextFrame - eventTime) <= 0.001) runTrackedFrame();
	}

	const positionAtLastInput = scrollTop;
	for (
		let frame = 0;
		frame < 500 && frameCallbacks.size > 0;
		frame++
	) {
		runTrackedFrame();
	}
	if (frameCallbacks.size > 0) {
		throw new Error('Continuous coarse stream did not settle');
	}
	const expectedDistance = 11 * DEFAULT_SETTINGS.stepSize;
	const motion = summarizeMotion(
		motionFrames,
		start,
		expectedDistance,
		scrollTop,
	);

	return {
		finalPosition: scrollTop,
		...motion,
		positionAtLastInput,
		settleTailMs: lastFrame - lastInput,
		maxFrameMovement: Math.max(maxFrameMovement, motion.maxFrameMovement),
		maxFrameOwners,
		maxWritesPerFrame,
		preventedEvents,
	};
}

function runFineOverload(
	frameIntervals: readonly number[] = [16],
): FineOverloadResult {
	clearQueue();
	resetRuntimeState();
	updateStateSettings(DEFAULT_SETTINGS);
	configure(
		DEFAULT_SETTINGS.animationTime,
		DEFAULT_SETTINGS.easing,
		DEFAULT_SETTINGS.pulseScale,
	);
	frameCallbacks.clear();
	const target = element('DIV', null, {
		scrollHeight: 100_000,
		clientHeight: 500,
		overflowY: 'auto',
	});
	const start = 20_000;
	const eventCount = 128;
	const eventInterval = 1;
	const inputDelta = 10;
	const lastInput = start + (eventCount - 1) * eventInterval;
	let intervalIndex = 0;
	const nextInterval = (): number =>
		frameIntervals[Math.min(intervalIndex++, frameIntervals.length - 1)] ?? 16;
	let nextFrameAt = start + nextInterval();
	let lastFrameAt = start;
	let maxFrameMovement = 0;

	const runTrackedFrame = (): void => {
		const before = target.scrollTop;
		runFrame(nextFrameAt);
		lastFrameAt = nextFrameAt;
		maxFrameMovement = Math.max(
			maxFrameMovement,
			Math.abs(target.scrollTop - before),
		);
		nextFrameAt += nextInterval();
	};

	for (let index = 0; index < eventCount; index++) {
		const eventTime = start + index * eventInterval;
		while (nextFrameAt < eventTime - 0.001) runTrackedFrame();
		fakeNow = eventTime;
		onWheel(
			new FakeWheelEvent(target, inputDelta, eventTime) as unknown as WheelEvent,
		);
		if (Math.abs(nextFrameAt - eventTime) <= 0.001) runTrackedFrame();
	}
	for (
		let frame = 0;
		frame < 500 && frameCallbacks.size > 0;
		frame++
	) {
		runTrackedFrame();
	}
	if (frameCallbacks.size > 0) {
		throw new Error('Fine overload workload did not settle');
	}
	return {
		finalPosition: target.scrollTop,
		maxFrameMovement,
		settleTailMs: lastFrameAt - lastInput,
	};
}

const REFERENCE_START = 30_000;
const REFERENCE_TICKS = 11;
const REFERENCE_TICK_INTERVAL_MS = 40;
const REFERENCE_LAST_INPUT =
	REFERENCE_START + (REFERENCE_TICKS - 1) * REFERENCE_TICK_INTERVAL_MS;
const REFERENCE_DISTANCE = REFERENCE_TICKS * DEFAULT_SETTINGS.stepSize;

function runLegacyHaloQueue(frameInterval = 16): ReferenceWorkloadResult {
	interface LegacyCommand {
		distance: number;
		lastPosition: number;
		startedAt: number;
	}
	const commands: LegacyCommand[] = [];
	let position = 0;
	let maxFrameMovement = 0;
	let nextFrameAt = REFERENCE_START + frameInterval;
	let lastFrameAt = REFERENCE_START;
	const motionFrames: MotionFrame[] = [];

	const runFrame = (): void => {
		const before = position;
		const frameDuration = nextFrameAt - lastFrameAt;
		const active: LegacyCommand[] = [];
		for (const command of commands) {
			const elapsed = nextFrameAt - command.startedAt;
			const finished = elapsed >= DEFAULT_SETTINGS.animationTime;
			const progress = finished
				? 1
				: 1 - Math.exp(
					-6.9314718 * elapsed / DEFAULT_SETTINGS.animationTime,
				);
			const movement = finished
				? command.distance - command.lastPosition
				: Math.trunc(
					command.distance * progress - command.lastPosition,
				);
			position += movement;
			command.lastPosition += movement;
			if (!finished) active.push(command);
		}
		commands.length = 0;
		commands.push(...active);
		lastFrameAt = nextFrameAt;
		motionFrames.push({
			duration: frameDuration,
			movement: position - before,
			time: nextFrameAt,
		});
		nextFrameAt += frameInterval;
		maxFrameMovement = Math.max(maxFrameMovement, Math.abs(position - before));
	};

	for (let tick = 0; tick < REFERENCE_TICKS; tick++) {
		const inputAt = REFERENCE_START + tick * REFERENCE_TICK_INTERVAL_MS;
		while (nextFrameAt < inputAt - 0.001) runFrame();
		commands.push({
			distance: DEFAULT_SETTINGS.stepSize,
			lastPosition: 0,
			startedAt: inputAt,
		});
		if (Math.abs(nextFrameAt - inputAt) <= 0.001) runFrame();
	}
	while (commands.length > 0) runFrame();
	const motion = summarizeMotion(
		motionFrames,
		REFERENCE_START,
		REFERENCE_DISTANCE,
		position,
	);
	return {
		finalPosition: position,
		...motion,
		maxFrameMovement: Math.max(maxFrameMovement, motion.maxFrameMovement),
		settleTailMs: lastFrameAt - REFERENCE_LAST_INPUT,
	};
}

function runFirstOrderReference(frameInterval = 16): ReferenceWorkloadResult {
	let remaining = 0;
	let position = 0;
	let maxFrameMovement = 0;
	let nextFrameAt = REFERENCE_START + frameInterval;
	let lastFrameAt = REFERENCE_START;
	let previousFrameAt = REFERENCE_START;
	const motionFrames: MotionFrame[] = [];

	const runFrame = (): void => {
		const frameDelta = nextFrameAt - previousFrameAt;
		previousFrameAt = nextFrameAt;
		const response = 1 - Math.exp(
			-6.9314718 * frameDelta / DEFAULT_SETTINGS.animationTime,
		);
		const movement = remaining * response;
		remaining -= movement;
		position += movement;
		maxFrameMovement = Math.max(maxFrameMovement, Math.abs(movement));
		lastFrameAt = nextFrameAt;
		motionFrames.push({
			duration: frameDelta,
			movement,
			time: nextFrameAt,
		});
		nextFrameAt += frameInterval;
	};

	for (let tick = 0; tick < REFERENCE_TICKS; tick++) {
		const inputAt = REFERENCE_START + tick * REFERENCE_TICK_INTERVAL_MS;
		while (nextFrameAt < inputAt - 0.001) runFrame();
		remaining += DEFAULT_SETTINGS.stepSize;
		if (Math.abs(nextFrameAt - inputAt) <= 0.001) runFrame();
	}
	while (Math.abs(remaining) > 1) runFrame();
	position += remaining;
	const motion = summarizeMotion(
		motionFrames,
		REFERENCE_START,
		REFERENCE_DISTANCE,
		position,
	);
	return {
		finalPosition: position,
		...motion,
		maxFrameMovement: Math.max(maxFrameMovement, motion.maxFrameMovement),
		settleTailMs: lastFrameAt - REFERENCE_LAST_INPUT,
	};
}

beforeAll(async () => {
	replaceGlobal('Element', FakeElement);
	replaceGlobal('Window', FakeWindow);
	replaceGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
		const id = nextFrame++;
		frameCallbacks.set(id, callback);
		return id;
	});
	replaceGlobal('cancelAnimationFrame', (id: number) => {
		frameCallbacks.delete(id);
	});
	replaceGlobal('performance', {
		now: () => fakeNow,
	});
	replaceGlobal('getComputedStyle', (target: FakeElement) => {
		computedStyleReads++;
		return target.styleState;
	});
	replaceGlobal('chrome', {
		storage: {
			sync: {
				get: (
					_keys: string[],
					callback?: (value: Record<string, unknown>) => void,
				) => {
					const value = {};
					callback?.(value);
					return Promise.resolve(value);
				},
			},
			onChanged: {
				addListener: () => {},
				removeListener: () => {},
			},
		},
	});

	fakeWindow = new FakeWindow();
	root = element('HTML', null, { scrollHeight: 3000, clientHeight: 900 });
	body = element('BODY', root, { scrollHeight: 3000, clientHeight: 900 });
	replaceGlobal('window', fakeWindow);
	replaceGlobal('document', {
		body,
		documentElement: root,
		scrollingElement: root,
		fullscreenElement: null,
		elementsFromPoint: () => [],
		querySelectorAll: () => [],
		addEventListener: () => {},
		removeEventListener: () => {},
	});

	({ onMouseDown, onMouseMove, onWheel, onKeydown, resetInputHandlers } =
		await import('../src/content/smooth-scroll-handlers'));
});

beforeEach(() => {
	clearQueue();
	resetRuntimeState();
	updateStateSettings(DEFAULT_SETTINGS);
	configure(
		DEFAULT_SETTINGS.animationTime,
		DEFAULT_SETTINGS.easing,
		DEFAULT_SETTINGS.pulseScale,
	);
	frameCallbacks.clear();
	nextFrame = 1;
	fakeNow = 1_000;
	computedStyleReads = 0;
	closestCalls = 0;
	matchesCalls = 0;
	reducedMotionMediaQuery.matches = false;
	fakeWindow = new FakeWindow();
	root = element('HTML', null, { scrollHeight: 3000, clientHeight: 900 });
	body = element('BODY', root, { scrollHeight: 3000, clientHeight: 900 });
	replaceGlobal('window', fakeWindow);
	replaceGlobal('document', {
		body,
		documentElement: root,
		scrollingElement: root,
		fullscreenElement: null,
		elementsFromPoint: () => [],
		querySelectorAll: () => [],
		addEventListener: () => {},
		removeEventListener: () => {},
	});
	resetInputHandlers();
});

afterAll(() => {
	clearQueue();
	restoreGlobals();
});

describe('smooth scroll routing', () => {
	test('never selects an overflow-hidden video layout as a scroll target', () => {
		const pageScroller = element('MAIN', body, {
			scrollHeight: 2400,
			clientHeight: 800,
			overflowY: 'auto',
		});
		const videoLayout = element('DIV', pageScroller, {
			scrollHeight: 720,
			clientHeight: 360,
			overflowY: 'hidden',
		});
		const overlay = element('DIV', videoLayout);

		const route = resolveScrollRoute(overlay as unknown as Element, 120);

		expect(route.kind).toBe('animate');
		expect(route.kind === 'animate' ? route.target : null).toBe(pageScroller);
		expect(videoLayout.scrollTop).toBe(0);
	});

	test('yields embedded applications and explicit virtual-scroller surfaces', () => {
		const canvas = element('CANVAS', body);
		const virtualScroller = element('DIV', body, {
			scrollHeight: 1200,
			clientHeight: 400,
			overflowY: 'auto',
		});
		virtualScroller.attributes.set('data-virtuoso-scroller', '');

		expect(shouldYieldWheel(canvas as unknown as Element)).toBe(true);
		expect(resolveScrollRoute(virtualScroller as unknown as Element, 120).kind).toBe('native');
	});

	test('preflights structural markers on body and root without reading styles', () => {
		const child = element('DIV', body);

		body.attributes.set('data-v-scroll', '');
		expect(resolveScrollRoute(child as unknown as Element, 120).kind).toBe('native');
		expect(computedStyleReads).toBe(0);
		expect(closestCalls).toBe(1);

		body.attributes.delete('data-v-scroll');
		root.attributes.set('role', 'application');
		expect(resolveScrollRoute(child as unknown as Element, 120).kind).toBe('native');
		expect(computedStyleReads).toBe(0);
		expect(closestCalls).toBe(2);
	});

	test('uses composed shadow and slot ancestry and stops at the nearest style decision', () => {
		const outerScroller = element('DIV', body, {
			scrollHeight: 2400,
			clientHeight: 800,
			overflowY: 'auto',
		});
		const host = element('DIV', outerScroller);
		const shadowScroller = element('DIV', null, {
			scrollHeight: 1200,
			clientHeight: 300,
			overflowY: 'auto',
		});
		const shadowTarget = element('SPAN', shadowScroller);
		const shadowPath = [
			shadowTarget,
			shadowScroller,
			host,
			outerScroller,
			body,
			root,
		];

		let route = resolveScrollRoute(
			host as unknown as Element,
			120,
			shadowPath as unknown as EventTarget[],
		);

		expect(route.kind).toBe('animate');
		expect(route.kind === 'animate' ? route.target : null).toBe(shadowScroller);
		expect(computedStyleReads).toBe(2);
		expect(closestCalls).toBe(0);
		expect(matchesCalls).toBe(shadowPath.length);

		const slot = element('SLOT', shadowScroller);
		const slottedTarget = element('SPAN', host);
		const slotPath = [
			slottedTarget,
			slot,
			shadowScroller,
			host,
			outerScroller,
			body,
			root,
		];
		computedStyleReads = 0;
		matchesCalls = 0;

		route = resolveScrollRoute(
			host as unknown as Element,
			120,
			slotPath as unknown as EventTarget[],
		);

		expect(route.kind).toBe('animate');
		expect(route.kind === 'animate' ? route.target : null).toBe(shadowScroller);
		expect(computedStyleReads).toBe(3);
		expect(closestCalls).toBe(0);
		expect(matchesCalls).toBe(slotPath.length);
	});

	test('treats audio and video as routing leaves without selecting their hidden layout', () => {
		const pageScroller = element('MAIN', body, {
			scrollHeight: 2400,
			clientHeight: 800,
			overflowY: 'auto',
		});
		const videoLayout = element('DIV', pageScroller, {
			scrollHeight: 720,
			clientHeight: 360,
			overflowY: 'hidden',
		});

		for (const tagName of ['AUDIO', 'VIDEO']) {
			const media = element(tagName, videoLayout, {
				scrollHeight: 900,
				clientHeight: 360,
				overflowY: 'auto',
			});
			computedStyleReads = 0;
			const route = resolveScrollRoute(media as unknown as Element, 120);

			expect(shouldYieldWheel(media as unknown as Element)).toBe(false);
			expect(route.kind).toBe('animate');
			expect(route.kind === 'animate' ? route.target : null).toBe(pageScroller);
			expect(computedStyleReads).toBe(2);
			expect(canAnimateTarget(media as unknown as Element, 120)).toBe(false);
			expect(media.scrollTop).toBe(0);
		}
		expect(videoLayout.scrollTop).toBe(0);
	});

	test('chains from an exhausted nested scroller to its scrollable parent', () => {
		const parent = element('DIV', body, {
			scrollHeight: 1600,
			clientHeight: 600,
			overflowY: 'auto',
		});
		const nested = element('DIV', parent, {
			scrollHeight: 800,
			clientHeight: 400,
			overflowY: 'auto',
		});
		nested.scrollTop = 400;

		const route = resolveScrollRoute(nested as unknown as Element, 120);

		expect(route.kind).toBe('animate');
		expect(route.kind === 'animate' ? route.target : null).toBe(parent);
		expect(canScrollBy(parent as unknown as Element, 120)).toBe(true);
	});

	test('keeps middle-click ownership on the nearest scroller at its boundary', () => {
		const parent = element('DIV', body, {
			scrollHeight: 1600,
			clientHeight: 600,
			overflowY: 'auto',
		});
		const nested = element('DIV', parent, {
			scrollHeight: 800,
			clientHeight: 400,
			overflowY: 'auto',
		});
		nested.scrollTop = 400;

		const route = resolveDirectScrollRoute(nested as unknown as Element);

		expect(route.kind).toBe('animate');
		expect(route.kind === 'animate' ? route.target : null).toBe(nested);
	});

	test('preserves explicit overscroll containment barriers', () => {
		const modal = element('DIV', body, {
			overflowY: 'hidden',
			overscrollBehaviorY: 'contain',
		});
		const child = element('DIV', modal);

		const route = resolveScrollRoute(child as unknown as Element, 120);

		expect(route.kind).toBe('blocked');
		expect(route.kind === 'blocked' ? route.target : null).toBe(modal);
	});

	test('does not infer containment from a large fixed layout shell', () => {
		const pageScroller = element('MAIN', body, {
			scrollHeight: 2400,
			clientHeight: 800,
			overflowY: 'auto',
		});
		const fixedShell = element('DIV', pageScroller, {
			position: 'fixed',
			rectHeight: 800,
		});
		const overlay = element('DIV', fixedShell);

		const route = resolveScrollRoute(overlay as unknown as Element, 120);

		expect(route.kind).toBe('animate');
		expect(route.kind === 'animate' ? route.target : null).toBe(pageScroller);
	});

	test('yields a locked viewport root to native scrolling without cancelling it', () => {
		body.styleState.overflowY = 'hidden';
		const child = element('DIV', body);

		const route = resolveScrollRoute(child as unknown as Element, 120);

		expect(route.kind).toBe('native');
		expect(canAnimateTarget(fakeWindow as unknown as Window, 120)).toBe(false);
	});

	test('reuses root and body styles within one viewport route', () => {
		body.styleState.overflowY = 'hidden';
		const child = element('DIV', body);

		const route = resolveScrollRoute(child as unknown as Element, 120);

		expect(route.kind).toBe('native');
		expect(computedStyleReads).toBe(3);
	});

	test('uses the document root when body overflow does not own the viewport', () => {
		root.styleState.overflowY = 'auto';
		body.styleState.overflowY = 'hidden';
		const child = element('DIV', body);

		const route = resolveScrollRoute(child as unknown as Element, 120);

		expect(route.kind).toBe('animate');
		expect(route.kind === 'animate' ? route.target : null).toBe(fakeWindow);
		expect(canAnimateTarget(fakeWindow as unknown as Window, 120)).toBe(true);
	});

	test('does not propagate body overflow when either root axis is non-visible', () => {
		root.styleState.overflowX = 'clip';
		root.styleState.overflowY = 'visible';
		body.styleState.overflowY = 'hidden';
		const child = element('DIV', body);

		const route = resolveScrollRoute(child as unknown as Element, 120);

		expect(route.kind).toBe('animate');
		expect(route.kind === 'animate' ? route.target : null).toBe(fakeWindow);
	});

	test('treats body as an independent scroller when root overflow does not propagate it', () => {
		root.styleState.overflowY = 'hidden';
		body.styleState.overflowY = 'auto';
		body.clientHeight = 500;
		body.scrollHeight = 1800;
		const child = element('DIV', body);

		const route = resolveScrollRoute(child as unknown as Element, 120);

		expect(route.kind).toBe('animate');
		expect(route.kind === 'animate' ? route.target : null).toBe(body);
	});

	test('invalidates an animation target when its overflow becomes layout-only', () => {
		const scroller = element('DIV', body, {
			scrollHeight: 1000,
			clientHeight: 400,
			overflowY: 'auto',
		});
		expect(canAnimateTarget(scroller as unknown as Element, 120)).toBe(true);

		scroller.styleState.overflowY = 'hidden';

		expect(canAnimateTarget(scroller as unknown as Element, 120)).toBe(false);
	});
});

describe('smooth scroll animation ownership', () => {
	test('does not replay displacement into a newly selected target', () => {
		configure(400, 'spring', 4);
		const first = element('DIV', body, {
			scrollHeight: 2000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		const second = element('DIV', body, {
			scrollHeight: 2000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		const start = performance.now();

		scrollTo(first as unknown as Element, 0, 300);
		runFrame(start + 16);
		const firstPosition = first.scrollTop;

		scrollTo(second as unknown as Element, 0, 100);
		runFrame(start + 32);
		runUntilIdle(start + 32);

		expect(first.scrollTop).toBe(firstPosition);
		expect(second.scrollTop).toBeCloseTo(100, 5);
	});

	test('coalesces repeated input without losing final displacement', () => {
		configure(400, 'ease-out', 4);
		const target = element('DIV', body, {
			scrollHeight: 3000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		const start = performance.now();

		for (let index = 0; index < 1000; index++) {
			scrollTo(target as unknown as Element, 0, 0.25);
		}
		runFrame(start + 16);
		runUntilIdle(start + 16);

		expect(target.scrollTop).toBeCloseTo(250, 5);
		expect(frameCallbacks.size).toBe(0);
	});

	test('ages existing displacement to each presentation-time admission', () => {
		const positionAfterSecondFrame = (withLateInput: boolean): number => {
			clearQueue();
			frameCallbacks.clear();
			fakeNow = 2_000;
			const target = element('DIV', body, {
				scrollHeight: 4_000,
				clientHeight: 500,
				overflowY: 'auto',
			});

			expect(scrollTo(target as unknown as Element, 0, 300)).toBe(true);
			runFrame(2_016);
			if (withLateInput) {
				fakeNow = 2_031;
				expect(scrollTo(target as unknown as Element, 0, 300)).toBe(true);
			}
			runFrame(2_032);
			const position = target.scrollTop;
			clearQueue();
			return position;
		};

		const baseline = positionAfterSecondFrame(false);
		const withLateInput = positionAfterSecondFrame(true);
		const oneMillisecondContribution = withLateInput - baseline;

		expect(oneMillisecondContribution).toBeGreaterThan(0);
		expect(oneMillisecondContribution).toBeLessThan(15);
	});

	test('keeps presentation-time integration valid when the first timestamp is zero', () => {
		const target = element('DIV', body, {
			scrollHeight: 4_000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		fakeNow = 0;

		expect(scrollTo(target as unknown as Element, 0, 300, undefined, 'coarse', 0)).toBe(true);
		expect(scrollTo(target as unknown as Element, 0, 300, undefined, 'coarse', 15)).toBe(true);
		runFrame(16);

		expect(target.scrollTop).toBeGreaterThan(20);
		expect(target.scrollTop).toBeLessThanOrEqual(35);
	});

	test('settles fine input within a low-latency budget at 240 Hz', () => {
		const target = element('DIV', body, {
			scrollHeight: 3_000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		fakeNow = 3_000;

		onWheel(new FakeWheelEvent(target, 20) as unknown as WheelEvent);
		const settledAt = runUntilIdleAtInterval(3_000, 4);

		expect(target.scrollTop).toBeCloseTo(20, 5);
		expect(settledAt - 3_000).toBeLessThanOrEqual(64);
	});

	test('bounds an overloaded fine stream independently of queued displacement', () => {
		const intervals = [16, 8, 4] as const;
		const results = intervals.map((interval) => runFineOverload([interval]));

		for (let index = 0; index < intervals.length; index++) {
			const interval = intervals[index];
			const result = results[index];
			if (interval === undefined || result === undefined) {
				throw new Error('Fine overload fixture did not produce every interval');
			}
			expect(result.finalPosition).toBeCloseTo(1_280, 5);
			expect(result.maxFrameMovement).toBeLessThanOrEqual(
				Math.min(
					SCROLL_LIMITS.maxSpeedPxPerMs * interval,
					SCROLL_LIMITS.maxFrameDisplacementPx,
				) + 0.01,
			);
			expect(result.settleTailMs).toBeLessThanOrEqual(
			tailBudgetMs(),
		);
	}

		const droppedFrame = runFineOverload([
			16, 16, 16, 16, 16, 16, 16, 16, 50, 16,
		]);
		expect(droppedFrame.maxFrameMovement).toBeLessThanOrEqual(
			SCROLL_LIMITS.maxFrameDisplacementPx,
		);
		expect(droppedFrame.settleTailMs).toBeLessThanOrEqual(
			tailBudgetMs(),
		);
	});

	test('saturates an adversarial fine backlog at the shared capacity', () => {
		const target = element('DIV', body, {
			scrollHeight: 100_000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		fakeNow = 21_000;

		let allInputsAdmitted = true;
		for (let index = 0; index < 1_000; index++) {
			allInputsAdmitted = scrollTo(
				target as unknown as Element,
				0,
				10,
				undefined,
				'fine',
				fakeNow,
			) && allInputsAdmitted;
		}
		const settledAt = runUntilIdleAtInterval(fakeNow, 16, 500);

		expect(allInputsAdmitted).toBe(true);
		expect(target.scrollTop).toBeCloseTo(maxBacklogPx(), 5);
		expect(settledAt - fakeNow).toBeLessThanOrEqual(
			tailBudgetMs(),
		);
	});

	test('uses a gentle coarse-wheel onset without a long exponential tail', () => {
		const target = element('DIV', body, {
			scrollHeight: 3_000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		fakeNow = 4_000;

		onWheel(new FakeWheelEvent(target, 120) as unknown as WheelEvent);
		runFrame(4_016);
		const firstFramePosition = target.scrollTop;
		const settledAt = runUntilIdleAtInterval(4_016, 16);

		expect(firstFramePosition).toBeGreaterThanOrEqual(20);
		expect(firstFramePosition).toBeLessThanOrEqual(35);
		expect(target.scrollTop).toBeCloseTo(300, 5);
		expect(settledAt - 4_000).toBeLessThanOrEqual(tailBudgetMs());
	});

	test('applies coarse response gain to non-spring easing without changing distance', () => {
		const firstFrameAtGain = (responseMultiplier: number): number => {
			clearQueue();
			frameCallbacks.clear();
			configure(400, 'linear', 4);
			const target = element('DIV', body, {
				scrollHeight: 3_000,
				clientHeight: 500,
				overflowY: 'auto',
			});

			expect(
				scrollTo(
					target as unknown as Element,
					0,
					300,
					undefined,
					'coarse',
					5_000,
					responseMultiplier,
				),
			).toBe(true);
			runFrame(5_016);
			const firstFramePosition = target.scrollTop;
			runUntilIdleAtInterval(5_016, 16);
			expect(target.scrollTop).toBeCloseTo(300, 5);
			return firstFramePosition;
		};

		const baseline = firstFrameAtGain(1);
		const accelerated = firstFrameAtGain(1.5);

		expect(accelerated).toBeGreaterThan(baseline);
		expect(accelerated).toBeLessThanOrEqual(
			COARSE_SCROLL_LIMITS.maxSpeedPxPerMs * 16,
		);
	});

	test('settles from browser-observed movement when scroll positions are quantized', () => {
		configure(400, 'spring', 4);
		const target = element('DIV', body, {
			scrollHeight: 3000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		let quantizedScrollTop = 0;
		Object.defineProperty(target, 'scrollTop', {
			configurable: true,
			get: () => quantizedScrollTop,
			set: (value: number) => {
				quantizedScrollTop = Math.round(value);
			},
		});
		const start = performance.now();

		expect(scrollTo(target as unknown as Element, 0, 48.5)).toBe(true);
		runFrame(start + 16);
		runUntilIdle(start + 16);

		expect(Math.abs(quantizedScrollTop - 48.5)).toBeLessThanOrEqual(0.5);
		expect(frameCallbacks.size).toBe(0);
	});

	test('carries subpixel progress instead of freezing a one-pixel input until timeout', () => {
		configure(400, 'spring', 4);
		const target = element('DIV', body, {
			scrollHeight: 3000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		let quantizedScrollTop = 0;
		Object.defineProperty(target, 'scrollTop', {
			configurable: true,
			get: () => quantizedScrollTop,
			set: (value: number) => {
				quantizedScrollTop = Math.round(value);
			},
		});
		const start = performance.now();

		expect(scrollTo(target as unknown as Element, 0, 1)).toBe(true);
		runFrame(start + 16);
		runFrame(start + 32);
		runFrame(start + 48);

		expect(quantizedScrollTop).toBe(1);
		runFrame(start + 64);
		expect(frameCallbacks.size).toBe(0);
	});

	test('bounds the response after a delayed first animation frame', () => {
		configure(400, 'spring', 4);
		const target = element('DIV', body, {
			scrollHeight: 2000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		const start = performance.now();

		expect(scrollTo(target as unknown as Element, 0, 300)).toBe(true);
		runFrame(start + 500);

		expect(target.scrollTop).toBeGreaterThan(0);
		expect(target.scrollTop).toBeLessThanOrEqual(
			COARSE_SCROLL_LIMITS.maxFrameDisplacementPx,
		);
		expect(frameCallbacks.size).toBe(1);

		runUntilIdle(start + 500);
		expect(target.scrollTop).toBeCloseTo(300, 5);
		expect(frameCallbacks.size).toBe(0);
	});

	test('keeps spring velocity continuous after a delayed-frame clamp', () => {
		configure(400, 'spring', 4);
		const target = element('DIV', body, {
			scrollHeight: 2000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		const start = performance.now();

		expect(scrollTo(target as unknown as Element, 0, 300)).toBe(true);
		runFrame(start + 500);
		const delayedPosition = target.scrollTop;
		runFrame(start + 516);
		const nextFrameMovement = target.scrollTop - delayedPosition;

		expect(nextFrameMovement).toBeGreaterThan(30);
		expect(nextFrameMovement).toBeLessThanOrEqual(
			Math.min(
				COARSE_SCROLL_LIMITS.maxFrameDisplacementPx,
				COARSE_SCROLL_LIMITS.maxSpeedPxPerMs * 16,
			),
		);
		runUntilIdle(start + 516);
		expect(target.scrollTop).toBeCloseTo(300, 5);
	});

	test('keeps the coarse spring refresh-independent at common wall times', () => {
		const positionAt64Ms = (frameInterval: number): number => {
			clearQueue();
			frameCallbacks.clear();
			fakeNow = 7_000;
			const target = element('DIV', body, {
				scrollHeight: 2_000,
				clientHeight: 500,
				overflowY: 'auto',
			});

			expect(scrollTo(target as unknown as Element, 0, 300)).toBe(true);
			for (
				let timestamp = 7_000 + frameInterval;
				timestamp <= 7_064;
				timestamp += frameInterval
			) {
				runFrame(timestamp);
			}
			const position = target.scrollTop;
			runUntilIdleAtInterval(7_064, frameInterval);
			expect(target.scrollTop).toBeCloseTo(300, 5);
			return position;
		};

		const at60Hz = positionAt64Ms(16);
		const at120Hz = positionAt64Ms(8);
		const at240Hz = positionAt64Ms(4);

		expect(at120Hz).toBeCloseTo(at60Hz, 5);
		expect(at240Hz).toBeCloseTo(at60Hz, 5);
	});

	test('uses response intensity for trajectory without changing distance or limits', () => {
		const trajectoryAt64Ms = (pulseScale: number): number => {
			clearQueue();
			frameCallbacks.clear();
			fakeNow = 7_500;
			configure(DEFAULT_SETTINGS.animationTime, 'spring', pulseScale);
			const target = element('DIV', body, {
				scrollHeight: 2_000,
				clientHeight: 500,
				overflowY: 'auto',
			});

			expect(scrollTo(target as unknown as Element, 0, 300)).toBe(true);
			let previousPosition = 0;
			for (let timestamp = 7_516; timestamp <= 7_564; timestamp += 16) {
				runFrame(timestamp);
				expect(target.scrollTop - previousPosition).toBeLessThanOrEqual(
					SCROLL_LIMITS.maxFrameDisplacementPx,
				);
				previousPosition = target.scrollTop;
			}
			const trajectory = target.scrollTop;
			runUntilIdleAtInterval(7_564, 16);
			expect(target.scrollTop).toBeCloseTo(300, 5);
			return trajectory;
		};

		const gentle = trajectoryAt64Ms(1);
		const responsive = trajectoryAt64Ms(10);

		expect(responsive).toBeGreaterThan(gentle + 10);
	});

	test('bounds a continuous accelerated coarse stream at common refresh rates', () => {
		const intervals = [16, 8, 4] as const;
		const results = intervals.map(interval => runCoarseStream([interval]));

		for (let index = 0; index < results.length; index++) {
			const result = results[index];
			const interval = intervals[index];
			expect(result).toBeDefined();
			expect(interval).toBeDefined();
			if (!result || interval === undefined) continue;

			expect(result.preventedEvents).toBe(11);
			expect(result.finalPosition).toBeCloseTo(11 * DEFAULT_SETTINGS.stepSize, 5);
			expect(result.settleTailMs).toBeLessThanOrEqual(
				tailBudgetMs(),
			);
			expect(result.maxFrameMovement).toBeLessThanOrEqual(
				Math.min(
					COARSE_SCROLL_LIMITS.maxFrameDisplacementPx,
					COARSE_SCROLL_LIMITS.maxSpeedPxPerMs * interval,
				) + 0.01,
			);
			expect(result.maxFrameOwners).toBeLessThanOrEqual(1);
			expect(result.maxWritesPerFrame).toBeLessThanOrEqual(1);
		}

		const positionsAtLastInput = results.map(
			result => result.positionAtLastInput,
		);
		expect(
			Math.max(...positionsAtLastInput) -
				Math.min(...positionsAtLastInput),
		).toBeLessThanOrEqual(5);
	});

	test('compares motion envelopes on one equal-distance fixed workload', () => {
		const current = runCoarseStream([16]);
		const legacy = runLegacyHaloQueue();
		const onePole = runFirstOrderReference();

		expect(current.finalPosition).toBeCloseTo(
			REFERENCE_DISTANCE,
			5,
		);
		expect(legacy.finalPosition).toBeCloseTo(REFERENCE_DISTANCE, 5);
		expect(onePole.finalPosition).toBeCloseTo(REFERENCE_DISTANCE, 5);
		expect(current.lostDistance).toBeLessThanOrEqual(0.5);
		expect(current.overshootDistance).toBeLessThanOrEqual(0.5);
		expect(current.firstWriteLatencyMs).toBeLessThanOrEqual(16);
		expect(current.p95FrameMovement).toBeLessThan(legacy.p95FrameMovement);
		expect(current.p95FrameMovement).toBeLessThan(onePole.p95FrameMovement);
		expect(current.p99VelocityDelta).toBeLessThan(legacy.p99VelocityDelta);
		expect(current.p99VelocityDelta).toBeLessThan(onePole.p99VelocityDelta);
		expect(current.p99Jerk).toBeLessThan(legacy.p99Jerk * 0.5);
		expect(current.p99Jerk).toBeLessThan(onePole.p99Jerk * 0.5);
		expect(current.settleTailMs).toBeLessThan(legacy.settleTailMs);
		expect(current.settleTailMs).toBeLessThan(onePole.settleTailMs);
	});

	test('caps a 50 ms dropped frame without extending the coarse tail budget', () => {
		const intervals = [
			...Array.from({ length: 26 }, () => 16),
			50,
			16,
		];
		const result = runCoarseStream(intervals);

		expect(result.finalPosition).toBeCloseTo(11 * DEFAULT_SETTINGS.stepSize, 5);
		expect(result.maxFrameMovement).toBeLessThanOrEqual(
			COARSE_SCROLL_LIMITS.maxFrameDisplacementPx + 0.01,
		);
		expect(result.settleTailMs).toBeLessThanOrEqual(
			tailBudgetMs(),
		);
		expect(result.maxFrameOwners).toBeLessThanOrEqual(1);
		expect(result.maxWritesPerFrame).toBeLessThanOrEqual(1);
	});

	test('saturates coarse backlog at the tail-derived capacity', () => {
		const target = element('DIV', null, {
			scrollHeight: 20_000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		fakeNow = 12_000;

		for (let tick = 0; tick < 100; tick++) {
			onWheel(
				new FakeWheelEvent(target, 120, fakeNow) as unknown as WheelEvent,
			);
		}
		const settledAt = runUntilIdleAtInterval(fakeNow, 16, 500);

		expect(target.scrollTop).toBeCloseTo(
			maxBacklogPx(),
			5,
		);
		expect(settledAt - fakeNow).toBeLessThanOrEqual(
			tailBudgetMs(),
		);
		expect(frameCallbacks.size).toBe(0);
	});

	test('stops before a live target changes to hidden overflow', () => {
		configure(400, 'spring', 4);
		const target = element('DIV', body, {
			scrollHeight: 2000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		const start = performance.now();

		scrollTo(target as unknown as Element, 0, 300);
		target.styleState.overflowY = 'hidden';
		runFrame(start + 16);

		expect(target.scrollTop).toBe(0);
		expect(frameCallbacks.size).toBe(0);
	});

	test('canonicalizes the document root to Window before admission', () => {
		configure(400, 'spring', 4);
		root.styleState.overflowY = 'auto';
		body.styleState.overflowY = 'hidden';
		const start = performance.now();

		expect(scrollTo(root as unknown as Element, 0, 300)).toBe(true);
		runFrame(start + 16);
		runUntilIdle(start + 16);

		expect(fakeWindow.scrollY).toBeCloseTo(300, 5);
		expect(root.scrollTop).toBe(0);
	});

	test('rejects a locked viewport before a caller can cancel native scrolling', () => {
		body.styleState.overflowY = 'hidden';

		expect(scrollTo(fakeWindow as unknown as Window, 0, 300)).toBe(false);
		expect(frameCallbacks.size).toBe(0);
	});

	test('cancels a scheduled animation even when requestAnimationFrame returns zero', () => {
		const target = element('DIV', body, {
			scrollHeight: 2000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		nextFrame = 0;

		expect(scrollTo(target as unknown as Element, 0, 300)).toBe(true);
		expect(frameCallbacks.has(0)).toBe(true);
		clearQueue();

		expect(frameCallbacks.size).toBe(0);
	});

	test('releases old momentum when a replacement target fails admission', () => {
		const first = element('DIV', body, {
			scrollHeight: 2000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		const invalid = element('DIV', body, {
			scrollHeight: 2000,
			clientHeight: 500,
			overflowY: 'hidden',
		});

		expect(scrollTo(first as unknown as Element, 0, 300)).toBe(true);
		expect(frameCallbacks.size).toBe(1);
		expect(scrollTo(invalid as unknown as Element, 0, 300)).toBe(false);

		expect(frameCallbacks.size).toBe(0);
		expect(first.scrollTop).toBe(0);
	});

	test('releases animation ownership after bounded observable writes make no progress', () => {
		const target = element('DIV', body, {
			scrollHeight: 2000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		let ignoredWrites = 0;
		Object.defineProperty(target, 'scrollTop', {
			configurable: true,
			get: () => 0,
			set: () => {
				ignoredWrites++;
			},
		});
		const start = performance.now();

		expect(scrollTo(target as unknown as Element, 0, 300)).toBe(true);
		for (let frame = 1; frame <= 12 && frameCallbacks.size > 0; frame++) {
			if (frame <= 3) {
				expect(scrollTo(target as unknown as Element, 0, 20)).toBe(true);
			}
			runFrame(start + frame * 16);
		}

		expect(frameCallbacks.size).toBe(0);
		expect(ignoredWrites).toBe(1);
	});

	test('uses a wall-clock deadline for unobserved writes at high refresh', () => {
		const target = element('DIV', body, {
			scrollHeight: 2_000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		Object.defineProperty(target, 'scrollTop', {
			configurable: true,
			get: () => 0,
			set: () => {},
		});
		fakeNow = 5_000;

		expect(scrollTo(target as unknown as Element, 0, 300)).toBe(true);
		for (let timestamp = 5_004; timestamp <= 5_052; timestamp += 4) {
			runFrame(timestamp);
		}
		expect(frameCallbacks.size).toBe(1);

		runFrame(5_056);
		expect(frameCallbacks.size).toBe(0);
	});

	test('releases rejected viewport writes without retrying them every frame', () => {
		let ignoredWrites = 0;
		fakeWindow.scrollBy = () => {
			ignoredWrites++;
		};
		const start = performance.now();

		expect(scrollTo(fakeWindow as unknown as Window, 0, 300)).toBe(true);
		for (let frame = 1; frame <= 12 && frameCallbacks.size > 0; frame++) {
			runFrame(start + frame * 16);
		}

		expect(frameCallbacks.size).toBe(0);
		expect(ignoredWrites).toBe(1);
	});

	test('does not treat high-refresh subpixel quantization as a stalled write', () => {
		configure(400, 'spring', 4);
		const target = element('DIV', body, {
			scrollHeight: 2000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		let quantizedScrollTop = 0;
		Object.defineProperty(target, 'scrollTop', {
			configurable: true,
			get: () => quantizedScrollTop,
			set: (value: number) => {
				quantizedScrollTop = Math.round(value);
			},
		});
		const start = performance.now();

		expect(scrollTo(target as unknown as Element, 0, 1.5)).toBe(true);
		for (let frame = 1; frame <= 200 && frameCallbacks.size > 0; frame++) {
			runFrame(start + frame * 4);
		}

		expect(Math.abs(quantizedScrollTop - 1.5)).toBeLessThanOrEqual(0.5);
		expect(frameCallbacks.size).toBe(0);
	});

	test('uses only the necessary scroll-axis reads in an animated element frame', () => {
		const target = element('DIV', body, {
			scrollHeight: 2000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		let scrollTop = 0;
		let scrollLeft = 0;
		let verticalReads = 0;
		let verticalWrites = 0;
		let horizontalReads = 0;
		let horizontalWrites = 0;
		Object.defineProperties(target, {
			scrollTop: {
				configurable: true,
				get: () => {
					verticalReads++;
					return scrollTop;
				},
				set: (value: number) => {
					verticalWrites++;
					scrollTop = value;
				},
			},
			scrollLeft: {
				configurable: true,
				get: () => {
					horizontalReads++;
					return scrollLeft;
				},
				set: (value: number) => {
					horizontalWrites++;
					scrollLeft = value;
				},
			},
		});
		const start = performance.now();

		expect(scrollTo(target as unknown as Element, 0, 300)).toBe(true);
		computedStyleReads = 0;
		verticalReads = 0;
		verticalWrites = 0;
		horizontalReads = 0;
		horizontalWrites = 0;
		const exponential = spyOn(Math, 'exp');
		try {
			runFrame(start + 16);

			expect(verticalReads).toBeLessThanOrEqual(2);
			expect(verticalWrites).toBe(1);
			expect(horizontalReads).toBe(0);
			expect(horizontalWrites).toBe(0);
			expect(computedStyleReads).toBeLessThanOrEqual(1);
			expect(exponential).toHaveBeenCalledTimes(1);
		} finally {
			exponential.mockRestore();
		}
	});
});

describe('smooth scroll input admission', () => {
	test('does not initialize wheel ownership inside a child frame', async () => {
		fakeWindow.top = new FakeWindow();
		try {
			const { init } = await import('../src/content/smooth-scroll');

			const dispose = await init();

			expect(typeof dispose).toBe('function');
			dispose();
		} finally {
			fakeWindow.top = fakeWindow;
		}
	});

	test('moves an ordinary root through wheel, admission, rAF, and Window scrolling', () => {
		root.styleState.overflowY = 'auto';
		body.styleState.overflowY = 'hidden';
		const child = element('DIV', body);
		const event = new FakeWheelEvent(child, 120);
		const start = performance.now();

		onWheel(event as unknown as WheelEvent);
		runFrame(start + 16);
		runUntilIdle(start + 16);

		expect(event.defaultPrevented).toBe(true);
		expect(fakeWindow.scrollY).toBeCloseTo(300, 5);
		expect(fakeWindow.lastScrollBehavior).toBe('instant');
		expect(frameCallbacks.size).toBe(0);
	});

	test('avoids a composed-path allocation for an ordinary admitted wheel', () => {
		const target = element('DIV', body, {
			scrollHeight: 3000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		const event = new FakeWheelEvent(target, 20);

		onWheel(event as unknown as WheelEvent);

		expect(event.composedPathCalls).toBe(0);
		expect(event.defaultPrevented).toBe(true);
		expect(computedStyleReads).toBe(1);
		expect(closestCalls).toBe(1);
		expect(frameCallbacks.size).toBe(1);
	});

	test('reads one composed path for an admitted open-shadow wheel', () => {
		const outer = element('DIV', body, {
			scrollHeight: 3_000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		const host = element('DIV', outer);
		host.shadowRoot = { activeElement: null };
		const shadowScroller = element('DIV', null, {
			scrollHeight: 2_000,
			clientHeight: 300,
			overflowY: 'auto',
		});
		const shadowTarget = element('SPAN', shadowScroller);
		const event = new FakeWheelEvent(host, 20, fakeNow, [
			shadowTarget,
			shadowScroller,
			host,
			outer,
			body,
			root,
		]);

		onWheel(event as unknown as WheelEvent);
		runUntilIdleAtInterval(fakeNow, 4);

		expect(event.composedPathCalls).toBe(1);
		expect(event.defaultPrevented).toBe(true);
		expect(shadowScroller.scrollTop).toBeCloseTo(20, 5);
		expect(outer.scrollTop).toBe(0);
	});

	test('ignores synthetic wheel input without disturbing an admitted real gesture', () => {
		const first = element('DIV', body, {
			scrollHeight: 3_000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		const syntheticTarget = element('DIV', body, {
			scrollHeight: 3_000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		const real = new FakeWheelEvent(first, 20, fakeNow);
		onWheel(real as unknown as WheelEvent);
		const synthetic = new FakeWheelEvent(
			syntheticTarget,
			120,
			fakeNow + 1,
			undefined,
			false,
		);

		onWheel(synthetic as unknown as WheelEvent);
		runUntilIdleAtInterval(fakeNow, 4);

		expect(real.defaultPrevented).toBe(true);
		expect(synthetic.defaultPrevented).toBe(false);
		expect(first.scrollTop).toBeCloseTo(20, 5);
		expect(syntheticTarget.scrollTop).toBe(0);
	});

	test('yields a target detached before admission without cancelling native input', () => {
		const target = element('DIV', body, {
			scrollHeight: 3_000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		target.isConnected = false;
		const event = new FakeWheelEvent(target, 120);

		onWheel(event as unknown as WheelEvent);

		expect(event.defaultPrevented).toBe(false);
		expect(frameCallbacks.size).toBe(0);
		expect(target.scrollTop).toBe(0);
	});

	test('keeps a vertical gesture locked through diagonal touchpad noise', () => {
		const target = element('DIV', body, {
			scrollHeight: 3_000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		const samples = [
			new FakeWheelEvent(target, 5, fakeNow, undefined, true, 4),
			new FakeWheelEvent(target, 5, fakeNow + 8, undefined, true, 6),
			new FakeWheelEvent(target, 5, fakeNow + 16, undefined, true, 4),
		];

		for (const sample of samples) onWheel(sample as unknown as WheelEvent);
		runUntilIdleAtInterval(fakeNow + 16, 4);

		expect(samples.every(sample => sample.defaultPrevented)).toBe(true);
		expect(target.scrollTop).toBeCloseTo(15, 5);
	});

	test('yields a clearly horizontal gesture without route or animation ownership', () => {
		const target = element('DIV', body, {
			scrollHeight: 3_000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		computedStyleReads = 0;
		const event = new FakeWheelEvent(
			target,
			5,
			fakeNow,
			undefined,
			true,
			100,
		);

		onWheel(event as unknown as WheelEvent);

		expect(event.defaultPrevented).toBe(false);
		expect(computedStyleReads).toBe(0);
		expect(frameCallbacks.size).toBe(0);
	});

	test('clears coarse acceleration when a page-owned sample takes over', () => {
		const target = element('DIV', body, {
			scrollHeight: 5_000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		updateStateSettings({
			...DEFAULT_SETTINGS,
			accelerationDelta: 300,
		});
		onWheel(new FakeWheelEvent(target, 120, fakeNow) as unknown as WheelEvent);
		onWheel(new FakeWheelEvent(target, 120, fakeNow + 40) as unknown as WheelEvent);
		expect(acceleration).toBeGreaterThan(1);
		const pageOwned = new FakeWheelEvent(target, 120, fakeNow + 80);
		pageOwned.defaultPrevented = true;

		onWheel(pageOwned as unknown as WheelEvent);

		expect(acceleration).toBe(1);
		expect(frameCallbacks.size).toBe(0);
	});

	test('yields an over-deep light-DOM path without allocating a composed path', () => {
		const path: FakeElement[] = [];
		let parent: FakeElement | null = null;
		for (let index = 0; index <= MAX_SCROLL_ROUTE_ELEMENTS; index++) {
			const current = element('DIV', parent);
			path.unshift(current);
			parent = current;
		}
		const target = path[0];
		if (!target) throw new Error('Deep route fixture did not create a target');
		const event = new FakeWheelEvent(target, 120, fakeNow, path);

		onWheel(event as unknown as WheelEvent);

		expect(event.composedPathCalls).toBe(0);
		expect(event.defaultPrevented).toBe(false);
		expect(computedStyleReads).toBe(0);
		expect(closestCalls).toBe(0);
		expect(matchesCalls).toBe(0);
		expect(frameCallbacks.size).toBe(0);
	});

	test('moves the outer scroller without mutating an overflow-hidden video layout', () => {
		const pageScroller = element('MAIN', body, {
			scrollHeight: 2400,
			clientHeight: 800,
			overflowY: 'auto',
		});
		const videoLayout = element('DIV', pageScroller, {
			scrollHeight: 720,
			clientHeight: 360,
			overflowY: 'hidden',
		});
		const overlay = element('DIV', videoLayout);
		const event = new FakeWheelEvent(overlay, 120);
		const start = performance.now();

		onWheel(event as unknown as WheelEvent);
		runFrame(start + 16);
		runUntilIdle(start + 16);

		expect(event.defaultPrevented).toBe(true);
		expect(pageScroller.scrollTop).toBeCloseTo(300, 5);
		expect(videoLayout.scrollTop).toBe(0);
		expect(fakeWindow.scrollY).toBe(0);
	});

	test('animates fine-grained wheel input instead of mutating synchronously', () => {
		root.styleState.overflowY = 'auto';
		body.styleState.overflowY = 'hidden';
		const child = element('DIV', body);
		const event = new FakeWheelEvent(child, 20);
		const start = performance.now();

		onWheel(event as unknown as WheelEvent);

		expect(event.defaultPrevented).toBe(true);
		expect(fakeWindow.scrollY).toBe(0);
		expect(frameCallbacks.size).toBe(1);

		runFrame(start + 16);
		expect(fakeWindow.scrollY).toBeGreaterThan(0);
		expect(fakeWindow.scrollY).toBeLessThan(20);

		runUntilIdle(start + 16);
		expect(fakeWindow.scrollY).toBeCloseTo(20, 5);
		expect(frameCallbacks.size).toBe(0);
	});

	test('does not convert browser event-queue age into a first-frame jump', () => {
		const target = element('DIV', null, {
			scrollHeight: 3_000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		fakeNow = 14_030;

		onWheel(
			new FakeWheelEvent(target, 120, 14_000) as unknown as WheelEvent,
		);
		runFrame(14_032);

		expect(target.scrollTop).toBeGreaterThan(0);
		expect(target.scrollTop).toBeLessThan(5);
	});

	test('keeps ambiguous repeated integer wheel samples on one fine trajectory', () => {
		const target = element('DIV', null, {
			scrollHeight: 4_000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		fakeNow = 6_000;

		for (let index = 0; index < 4; index++) {
			onWheel(new FakeWheelEvent(target, 120) as unknown as WheelEvent);
			fakeNow += 8;
		}
		clearQueue();
		target.scrollTop = 0;

		fakeNow += 100;
		for (let index = 0; index < 3; index++) {
			onWheel(new FakeWheelEvent(target, 50) as unknown as WheelEvent);
			fakeNow += 8;
		}
		runUntilIdleAtInterval(fakeNow, 4);

		expect(target.scrollTop).toBeCloseTo(
			3 * 50,
			5,
		);
	});

	test('promotes a fine-leading stream when a strong coarse sample arrives', () => {
		const target = element('DIV', null, {
			scrollHeight: 4_000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		fakeNow = 6_500;
		const fineLead = new FakeWheelEvent(target, 1, fakeNow);
		const coarse = new FakeWheelEvent(target, 120, fakeNow + 8);

		onWheel(fineLead as unknown as WheelEvent);
		onWheel(coarse as unknown as WheelEvent);
		runUntilIdleAtInterval(fakeNow + 8, 4);

		expect(fineLead.defaultPrevented).toBe(true);
		expect(coarse.defaultPrevented).toBe(true);
		expect(target.scrollTop).toBeCloseTo(
			1 + DEFAULT_SETTINGS.stepSize,
			5,
		);
	});

	test('consumes the route admission without repeating style work in the engine', () => {
		const target = element('DIV', null, {
			scrollHeight: 3000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		computedStyleReads = 0;

		for (let index = 0; index < 64; index++) {
			onWheel(new FakeWheelEvent(target, 0.25) as unknown as WheelEvent);
		}

		expect(frameCallbacks.size).toBe(1);
		expect(computedStyleReads).toBe(64);
	});

	test('scopes coarse-wheel acceleration to one target and direction', () => {
		updateStateSettings({
			...DEFAULT_SETTINGS,
			accelerationDelta: 300,
		});
		const first = element('DIV', null, {
			scrollHeight: 3000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		const second = element('DIV', null, {
			scrollHeight: 3000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		const firstStart = performance.now();

		onWheel(new FakeWheelEvent(first, 120) as unknown as WheelEvent);
		runUntilIdle(firstStart);
		const secondStart = performance.now();
		onWheel(new FakeWheelEvent(second, 120) as unknown as WheelEvent);
		runUntilIdle(secondStart);

		expect(first.scrollTop).toBeCloseTo(300, 5);
		expect(second.scrollTop).toBeCloseTo(300, 5);

		second.scrollTop = 1000;
		const reverseStart = performance.now();
		onWheel(new FakeWheelEvent(second, -120) as unknown as WheelEvent);
		runUntilIdle(reverseStart);

		expect(second.scrollTop).toBeCloseTo(700, 5);
	});

	test('allows an explicit smooth-motion policy to override reduced motion', () => {
		root.styleState.overflowY = 'auto';
		body.styleState.overflowY = 'hidden';
		reducedMotionMediaQuery.matches = true;
		updateStateSettings({
			...DEFAULT_SETTINGS,
			respectReducedMotion: false,
		});
		const child = element('DIV', body);
		const event = new FakeWheelEvent(child, 120);
		const start = performance.now();

		onWheel(event as unknown as WheelEvent);
		runFrame(start + 16);
		runUntilIdle(start + 16);

		expect(event.defaultPrevented).toBe(true);
		expect(fakeWindow.scrollY).toBeCloseTo(300, 5);
	});

	test('yields to reduced motion when the user requests that policy', () => {
		root.styleState.overflowY = 'auto';
		body.styleState.overflowY = 'hidden';
		reducedMotionMediaQuery.matches = true;
		updateStateSettings({
			...DEFAULT_SETTINGS,
			respectReducedMotion: true,
		});
		const child = element('DIV', body);
		const event = new FakeWheelEvent(child, 120);

		onWheel(event as unknown as WheelEvent);

		expect(event.defaultPrevented).toBe(false);
		expect(fakeWindow.scrollY).toBe(0);
		expect(frameCallbacks.size).toBe(0);
	});

	test('canonicalizes the body target when viewport ownership changes', () => {
		root.styleState.overflowY = 'hidden';
		body.styleState.overflowY = 'auto';
		body.clientHeight = 500;
		body.scrollHeight = 1800;
		const child = element('DIV', body);
		const firstStart = performance.now();

		onWheel(new FakeWheelEvent(child, 20) as unknown as WheelEvent);
		expect(body.scrollTop).toBe(0);
		runFrame(firstStart + 16);
		runUntilIdle(firstStart + 16);
		expect(body.scrollTop).toBeCloseTo(20, 5);

		root.styleState.overflowY = 'visible';
		const secondStart = performance.now();
		onWheel(new FakeWheelEvent(child, 20) as unknown as WheelEvent);
		expect(fakeWindow.scrollY).toBe(0);
		runFrame(secondStart + 16);
		runUntilIdle(secondStart + 16);

		expect(body.scrollTop).toBeCloseTo(20, 5);
		expect(fakeWindow.scrollY).toBeCloseTo(20, 5);
	});

	test('re-routes a parent to the nearest nested owner after direction changes', () => {
		const parent = element('DIV', body, {
			scrollHeight: 2000,
			clientHeight: 600,
			overflowY: 'auto',
		});
		const nested = element('DIV', parent, {
			scrollHeight: 800,
			clientHeight: 400,
			overflowY: 'auto',
		});
		nested.scrollTop = 400;
		const firstStart = performance.now();

		onWheel(new FakeWheelEvent(nested, 120) as unknown as WheelEvent);
		runFrame(firstStart + 16);
		runUntilIdle(firstStart + 16);
		const parentAfterDown = parent.scrollTop;
		const secondStart = performance.now();

		onWheel(new FakeWheelEvent(nested, -120) as unknown as WheelEvent);
		runFrame(secondStart + 16);
		runUntilIdle(secondStart + 16);

		expect(parentAfterDown).toBeGreaterThan(0);
		expect(parent.scrollTop).toBe(parentAfterDown);
		expect(nested.scrollTop).toBeLessThan(400);
	});

	test('re-resolves same-direction input when a nearer scroll owner appears', () => {
		root.styleState.overflowY = 'auto';
		body.styleState.overflowY = 'hidden';
		updateStateSettings({
			...DEFAULT_SETTINGS,
			accelerationMax: 1,
		});
		const parent = element('DIV', body, {
			scrollHeight: 2000,
			clientHeight: 500,
			overflowY: 'visible',
		});
		const child = element('DIV', parent);
		const firstStart = performance.now();

		onWheel(new FakeWheelEvent(child, 120) as unknown as WheelEvent);
		runUntilIdle(firstStart);
		const windowAfterFirstInput = fakeWindow.scrollY;

		parent.styleState.overflowY = 'auto';
		const secondStart = performance.now();
		onWheel(new FakeWheelEvent(child, 120) as unknown as WheelEvent);
		runUntilIdle(secondStart);

		expect(windowAfterFirstInput).toBeCloseTo(300, 5);
		expect(fakeWindow.scrollY).toBeCloseTo(windowAfterFirstInput, 5);
		expect(parent.scrollTop).toBeCloseTo(300, 5);
	});

	test('uses composed shadow ancestry for middle-click ownership', () => {
		const outer = element('DIV', body, {
			scrollHeight: 3_000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		const host = element('DIV', outer);
		host.shadowRoot = { activeElement: null };
		const shadowScroller = element('DIV', null, {
			scrollHeight: 2_000,
			clientHeight: 300,
			overflowY: 'auto',
		});
		const shadowTarget = element('SPAN', shadowScroller);
		let composedPathCalls = 0;
		const startEvent = {
			button: 1,
			clientY: 0,
			defaultPrevented: false,
			isTrusted: true,
			target: host,
			composedPath() {
				composedPathCalls++;
				return [shadowTarget, shadowScroller, host, outer, body, root];
			},
			preventDefault() {
				this.defaultPrevented = true;
			},
		};

		onMouseDown(startEvent as unknown as MouseEvent);
		onMouseMove({
			clientY: 10,
			isTrusted: true,
		} as MouseEvent);
		runUntilIdleAtInterval(fakeNow, 4);

		expect(composedPathCalls).toBe(1);
		expect(startEvent.defaultPrevented).toBe(true);
		expect(shadowScroller.scrollTop).toBeCloseTo(20, 5);
		expect(outer.scrollTop).toBe(0);
	});

	test('stops middle-click scrolling before a live target becomes layout-only', () => {
		const target = element('DIV', body, {
			scrollHeight: 2000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		const startEvent = {
			button: 1,
			clientY: 0,
			defaultPrevented: false,
			isTrusted: true,
			target,
			timeStamp: fakeNow,
			preventDefault() {
				this.defaultPrevented = true;
			},
		};

		onMouseDown(startEvent as unknown as MouseEvent);
		target.styleState.overflowY = 'hidden';
		onMouseMove({
			clientY: 20,
			isTrusted: true,
			timeStamp: fakeNow + 1,
		} as MouseEvent);
		runFrame(fakeNow + 16);

		expect(startEvent.defaultPrevented).toBe(true);
		expect(target.scrollTop).toBe(0);
		expect(state.isMiddleScrolling).toBe(false);
	});

	test('does not transfer middle-click ownership when body becomes the viewport root', () => {
		root.styleState.overflowY = 'hidden';
		body.styleState.overflowY = 'auto';
		body.clientHeight = 500;
		body.scrollHeight = 1800;
		const child = element('DIV', body);
		const startEvent = {
			button: 1,
			clientY: 0,
			defaultPrevented: false,
			isTrusted: true,
			target: child,
			timeStamp: fakeNow,
			preventDefault() {
				this.defaultPrevented = true;
			},
		};

		onMouseDown(startEvent as unknown as MouseEvent);
		root.styleState.overflowY = 'visible';
		onMouseMove({
			clientY: 20,
			isTrusted: true,
			timeStamp: fakeNow + 1,
		} as MouseEvent);
		runFrame(fakeNow + 16);

		expect(body.scrollTop).toBe(0);
		expect(fakeWindow.scrollY).toBe(0);
		expect(state.isMiddleScrolling).toBe(false);
	});

	test('coalesces high-frequency middle movement into the engine single writer', () => {
		const target = element('DIV', body, {
			scrollHeight: 4_000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		let scrollTop = 0;
		let writes = 0;
		Object.defineProperty(target, 'scrollTop', {
			configurable: true,
			get: () => scrollTop,
			set: (value: number) => {
				writes++;
				scrollTop = value;
			},
		});
		const startEvent = {
			button: 1,
			clientY: 0,
			defaultPrevented: false,
			isTrusted: true,
			target,
			timeStamp: fakeNow,
			preventDefault() {
				this.defaultPrevented = true;
			},
		};
		onMouseDown(startEvent as unknown as MouseEvent);
		computedStyleReads = 0;

		for (let index = 1; index <= 1_000; index++) {
			onMouseMove({
				clientY: index / 10,
				isTrusted: true,
				timeStamp: fakeNow + index / 1_000,
			} as MouseEvent);
		}

		expect(writes).toBe(0);
		expect(computedStyleReads).toBe(0);
		expect(frameCallbacks.size).toBe(1);
		let timestamp = fakeNow;
		let maxWritesPerFrame = 0;
		for (let frame = 0; frame < 200 && frameCallbacks.size > 0; frame++) {
			const beforeWrites = writes;
			timestamp += 4;
			runFrame(timestamp);
			maxWritesPerFrame = Math.max(
				maxWritesPerFrame,
				writes - beforeWrites,
			);
		}

		expect(frameCallbacks.size).toBe(0);
		expect(maxWritesPerFrame).toBeLessThanOrEqual(1);
		expect(scrollTop).toBeCloseTo(200, 5);
	});
});

describe('smooth scroll keyboard', () => {
	// eff: Builds a trusted KeyboardEvent fixture for the given key. preventDefault
	// flips defaultPrevented so the handler's admission decision is observable.
	function keyEvent(key: string, extras: Partial<{
		shiftKey: boolean;
		ctrlKey: boolean;
		altKey: boolean;
		metaKey: boolean;
		repeat: boolean;
	}> = {}): KeyboardEvent {
		const event = {
			key,
			isTrusted: true,
			defaultPrevented: false,
			shiftKey: false,
			ctrlKey: false,
			altKey: false,
			metaKey: false,
			repeat: false,
			...extras,
			preventDefault() { (this as { defaultPrevented: boolean }).defaultPrevented = true; },
		};
		return event as unknown as KeyboardEvent;
	}

	test('spacebar scrolls page smoothly', () => {
		root.styleState.overflowY = 'auto';
		body.styleState.overflowY = 'hidden';
		const event = keyEvent(' ');
		const start = performance.now();

		onKeydown(event);

		expect(event.defaultPrevented).toBe(true);
		expect(frameCallbacks.size).toBe(1);
		runUntilIdle(start + 16);
		expect(fakeWindow.scrollY).toBeCloseTo(window.innerHeight * 0.9, 5);
	});

	test('spacebar scrolls even when site already preventDefault', () => {
		// Sites commonly preventDefault spacebar to suppress native instant jump
		// or bind shortcuts. HALO must still animate — programmatic scrollTo is
		// unaffected by preventDefault. Without this, spacebar never scrolls.
		root.styleState.overflowY = 'auto';
		body.styleState.overflowY = 'hidden';
		const event = keyEvent(' ');
		event.preventDefault();
		const start = performance.now();

		onKeydown(event);

		expect(frameCallbacks.size).toBe(1);
		runUntilIdle(start + 16);
		expect(fakeWindow.scrollY).toBeCloseTo(window.innerHeight * 0.9, 5);
	});

	test('arrow keys still yield when site already preventDefault', () => {
		root.styleState.overflowY = 'auto';
		body.styleState.overflowY = 'hidden';
		const event = keyEvent('ArrowDown');
		event.preventDefault();

		onKeydown(event);

		expect(frameCallbacks.size).toBe(0);
	});

	test('long-press arrow key accumulates without clearing the queue', () => {
		// e.repeat must NOT clearQueue — otherwise each repeat resets animation
		// to frame zero, making long-press feel frozen and slow.
		root.styleState.overflowY = 'auto';
		body.styleState.overflowY = 'hidden';
		root.scrollHeight = 20_000;

		const first = keyEvent('ArrowDown');
		onKeydown(first);
		expect(frameCallbacks.size).toBe(1);

		// Advance a few frames so the engine has a live animation.
		runFrame(1_016);
		runFrame(1_032);
		expect(frameCallbacks.size).toBe(1);

		// A repeat event arrives — engine should accumulate, not reset.
		const repeat = keyEvent('ArrowDown', { repeat: true });
		onKeydown(repeat);

		expect(frameCallbacks.size).toBe(1);
	});

	test('first press clears stale queue, repeat does not', () => {
		root.styleState.overflowY = 'auto';
		body.styleState.overflowY = 'hidden';
		root.scrollHeight = 20_000;

		onKeydown(keyEvent('ArrowDown'));
		expect(frameCallbacks.size).toBe(1);

		// Repeat should not clear — verify a second repeat keeps the engine alive.
		onKeydown(keyEvent('ArrowDown', { repeat: true }));
		expect(frameCallbacks.size).toBe(1);

		// A fresh (non-repeat) PageDown clears the arrow animation and starts new.
		onKeydown(keyEvent('PageDown'));
		expect(frameCallbacks.size).toBe(1);
	});
});

describe('sidepanel smooth scroll', () => {
	test('keeps fine wheel displacement physical with one admission style read', async () => {
		const { initScroll } = await import('../src/entry/sidepanel-scroll');
		const target = element('DIV', body, {
			scrollHeight: 3_000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		const dispose = initScroll();

		try {
			const event = new FakeWheelEvent(target, 20, 15_000);
			fakeNow = 15_000;
			computedStyleReads = 0;

			fakeWindow.dispatch('wheel', event as unknown as Event);

			expect(event.composedPathCalls).toBe(0);
			expect(event.defaultPrevented).toBe(true);
			expect(computedStyleReads).toBe(1);

			runUntilIdleAtInterval(fakeNow, 16, 500);
			expect(target.scrollTop).toBeCloseTo(20, 5);
		} finally {
			dispose();
		}
	});

	test('re-resolves a newly scrollable nearer owner during one gesture', async () => {
		const { initScroll } = await import('../src/entry/sidepanel-scroll');
		const parent = element('DIV', body, {
			scrollHeight: 3_000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		const child = element('DIV', parent);
		const dispose = initScroll();

		try {
			fakeNow = 16_000;
			fakeWindow.dispatch(
				'wheel',
				new FakeWheelEvent(child, 120, fakeNow) as unknown as Event,
			);
			runFrame(16_016);
			const parentAtRouteChange = parent.scrollTop;

			child.scrollHeight = 2_000;
			child.clientHeight = 400;
			child.styleState.overflowY = 'auto';
			fakeNow = 16_040;
			fakeWindow.dispatch(
				'wheel',
				new FakeWheelEvent(child, 120, fakeNow) as unknown as Event,
			);
			runUntilIdleAtInterval(fakeNow, 16, 500);

			expect(parentAtRouteChange).toBeGreaterThan(0);
			expect(parent.scrollTop).toBeCloseTo(parentAtRouteChange, 5);
			expect(child.scrollTop).toBeCloseTo(DEFAULT_SETTINGS.stepSize, 5);
		} finally {
			dispose();
		}
	});

	test('uses acceleration as response gain without multiplying tick distance', async () => {
		const { initScroll } = await import('../src/entry/sidepanel-scroll');
		const target = element('DIV', null, {
			scrollHeight: 3_000,
			clientHeight: 500,
			overflowY: 'auto',
		});
		const dispose = initScroll();

		try {
			fakeNow = 15_030;
			const first = new FakeWheelEvent(target, 120, 15_000);
			fakeWindow.dispatch('wheel', first as unknown as Event);
			runFrame(15_032);
			const firstFramePosition = target.scrollTop;

			fakeNow = 15_070;
			const second = new FakeWheelEvent(target, 120, 15_040);
			fakeWindow.dispatch('wheel', second as unknown as Event);
			const settledAt = runUntilIdleAtInterval(fakeNow, 16, 500);

			expect(first.defaultPrevented).toBe(true);
			expect(second.defaultPrevented).toBe(true);
			expect(firstFramePosition).toBeGreaterThan(0);
			expect(firstFramePosition).toBeLessThan(5);
			expect(target.scrollTop).toBeCloseTo(
				2 * DEFAULT_SETTINGS.stepSize,
				5,
			);
			expect(settledAt - 15_070).toBeLessThanOrEqual(
				tailBudgetMs(),
			);
		} finally {
			dispose();
		}
	});
});

describe('smooth scroll settings boundary', () => {
	test('clamps imported and persisted values to the executable contract', () => {
		const settings = normalizeScrollSettings({
			enabled: 'yes',
			stepSize: 9999,
			animationTime: -10,
			accelerationMax: Number.NaN,
			pulseScale: 0,
			easing: 'unknown',
		});

		expect(settings.enabled).toBe(true);
		expect(settings.stepSize).toBe(500);
		expect(settings.animationTime).toBe(50);
		expect(settings.accelerationMax).toBe(3);
		expect(settings.pulseScale).toBe(1);
		expect(settings.easing).toBe('spring');
	});
});
