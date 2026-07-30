// goal: Allocation-free wheel normalization, axis locking, and stream classification
// inv: Each surface owns gesture state while this module owns the classification rule

import type { ScrollInputMode } from './types';

export const WHEEL_STREAM_IDLE_MS = 80;
const INITIAL_HORIZONTAL_LOCK_RATIO = 1.35;
const AXIS_SWITCH_RATIO = 1.8;
const AXIS_SWITCH_SAMPLE_COUNT = 2;

export interface WheelGestureState {
	axis: 'horizontal' | 'vertical' | null;
	oppositeAxisSamples: number;
	inputMode: ScrollInputMode | 'unknown';
	lastEventTimestamp: number;
}

export type WheelGestureDecision = ScrollInputMode | 'horizontal';

export function createWheelGestureState(): WheelGestureState {
	return {
		axis: null,
		oppositeAxisSamples: 0,
		inputMode: 'unknown',
		lastEventTimestamp: Number.NEGATIVE_INFINITY,
	};
}

export function resetWheelGestureState(state: WheelGestureState): void {
	state.axis = null;
	state.oppositeAxisSamples = 0;
	state.inputMode = 'unknown';
	state.lastEventTimestamp = Number.NEGATIVE_INFINITY;
}

function isStrongCoarseSample(event: WheelEvent, magnitude: number): boolean {
	if (event.deltaMode !== 0) return true;
	if (!Number.isInteger(event.deltaY)) return false;
	return magnitude >= 80;
}

function resolveGestureAxis(
	event: WheelEvent,
	state: WheelGestureState,
): 'horizontal' | 'vertical' {
	const horizontal = Math.abs(event.deltaX);
	const vertical = Math.abs(event.deltaY);
	if (state.axis === null) {
		state.axis =
			horizontal >= vertical * INITIAL_HORIZONTAL_LOCK_RATIO
				? 'horizontal'
				: 'vertical';
		return state.axis;
	}

	const oppositeDominates = state.axis === 'vertical'
		? horizontal >= vertical * AXIS_SWITCH_RATIO
		: vertical >= horizontal * AXIS_SWITCH_RATIO;
	state.oppositeAxisSamples = oppositeDominates
		? state.oppositeAxisSamples + 1
		: 0;
	if (state.oppositeAxisSamples >= AXIS_SWITCH_SAMPLE_COUNT) {
		state.axis = state.axis === 'vertical' ? 'horizontal' : 'vertical';
		state.oppositeAxisSamples = 0;
	}
	return state.axis;
}

function classifyInputMode(
	event: WheelEvent,
	state: WheelGestureState,
): ScrollInputMode {
	const magnitude = Math.abs(event.deltaY);
	const strongCoarse = isStrongCoarseSample(event, magnitude);
	if (strongCoarse) {
		state.inputMode = 'coarse';
		return 'coarse';
	}
	if (state.inputMode === 'coarse') {
		return 'coarse';
	}
	// Integer pixel deltas below the strong coarse threshold are ambiguous:
	// high-resolution wheels and touchpads commonly quantize them. Keep their
	// physical distance and one continuous fine response for the whole gesture
	// instead of changing both distance and dynamics on the second sample.
	state.inputMode = 'fine';
	return 'fine';
}

export function classifyWheelGesture(
	event: WheelEvent,
	timestamp: number,
	state: WheelGestureState,
): WheelGestureDecision {
	if (
		!Number.isFinite(state.lastEventTimestamp) ||
		timestamp - state.lastEventTimestamp >= WHEEL_STREAM_IDLE_MS
	) {
		resetWheelGestureState(state);
	}
	const axis = resolveGestureAxis(event, state);
	const inputMode = classifyInputMode(event, state);
	state.lastEventTimestamp = timestamp;
	return axis === 'horizontal' ? 'horizontal' : inputMode;
}

export function normalizeWheelDeltaY(event: WheelEvent): number {
	if (event.deltaMode === 1) return event.deltaY * 40;
	if (event.deltaMode === 2) return event.deltaY * window.innerHeight;
	return event.deltaY;
}

export function wheelEventTarget(event: WheelEvent): Element | null {
	const target = event.target;
	if (target instanceof Element) return target;
	return target instanceof Node ? target.parentElement : null;
}

export function wheelNeedsComposedPath(target: Element): boolean {
	return (
		target.assignedSlot !== null ||
		target.shadowRoot !== null ||
		target.getRootNode() !== document
	);
}

export function wheelEventTimestamp(event: WheelEvent): number {
	return Number.isFinite(event.timeStamp)
		? event.timeStamp
		: performance.now();
}
