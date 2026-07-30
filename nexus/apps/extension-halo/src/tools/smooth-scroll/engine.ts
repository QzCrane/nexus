// goal: Target-scoped, constant-time smooth-scroll animation engine
// inv: Pending displacement belongs to exactly one live scroll target

import type { EasingType, ScrollInputMode } from './types';
import type {
	ScrollAdmission,
	ScrollTargetMetrics,
	ScrollTargetMetricsBuffer,
} from './utils';
import {
	canonicalizeScrollTarget,
	matchesScrollAdmission,
	readAnimatableScrollTarget,
} from './utils';

const state = {
	frame: null as number | null,
	target: null as Element | Window | null,
	directionX: 0,
	directionY: 0,
	remainingX: 0,
	remainingY: 0,
	// Logical easing and browser pixel quantization are separate authorities.
	// remainingY is not yet planned; carryY is planned but not yet observed.
	carryY: 0,
	pendingWriteY: 0,
	writeOriginY: 0,
	pendingWriteStartedAt: null as number | null,
	velocityY: 0,
	inputMode: 'coarse' as ScrollInputMode,
	coarseResponseMultiplierY: 1,
	coarseResponseTargetY: 1,
	coarseTailDeadline: null as number | null,
	lastDynamicsTime: null as number | null,
	lastFrameTime: null as number | null,
	activeFrameAge: 0,
	onOwnershipLost: null as (() => void) | null,
	time: 400,
	easing: 'spring' as EasingType,
	pulseScale: 4,
};

const LOG2_10 = 6.9314718;
const SCROLL_POSITION_EPSILON = 0.5;
const COMPLETION_RESIDUAL_EPSILON = 1;
const OBSERVED_WRITE_TOLERANCE = 0.5;
const WRITE_OBSERVATION_TIMEOUT_MS = 50;
const FINE_TIME_RATIO = 0.03;
const MIN_FINE_TIME_CONSTANT_MS = 8;
const MAX_FINE_FRAME_RESPONSE = 0.8;
const MAX_COARSE_FRAME_RESPONSE = 0.25;
const COARSE_SPRING_SCALE = 12;
const COARSE_RESPONSE_TRANSITION_MS = 48;
const MAX_COARSE_RESPONSE_MULTIPLIER = 10;
// 按帧约束（与 animationTime 无关，不可放宽，否则会破坏帧率性能）
const MAX_COARSE_SPEED_PX_PER_MS = 6;
const MAX_COARSE_FRAME_DISPLACEMENT_PX = 100;
// 按时长约束的下限（防极端短动画导致 tail planner 失效）
const MIN_COARSE_TAIL_MS = 280;
const COARSE_WRITE_SETTLE_RESERVE_MS = 32;
const COARSE_DROPPED_FRAME_BUDGET_MS = 50;
const COARSE_DROPPED_FRAME_LOSS_PX = Math.max(
	0,
	MAX_COARSE_SPEED_PX_PER_MS *
		COARSE_DROPPED_FRAME_BUDGET_MS -
		MAX_COARSE_FRAME_DISPLACEMENT_PX,
);
const ANIMATABLE_OVERFLOW = new Set(['auto', 'scroll', 'overlay']);
const windowVerticalWriteOptions: ScrollToOptions = {
	behavior: 'instant',
	left: 0,
	top: 0,
};
const targetMetrics: ScrollTargetMetricsBuffer = {
	target: null as unknown as Element,
	positionY: 0,
	maxY: 0,
	capacityY: 0,
};

// 按时长约束派生自 state.time，让 animationTime 字段真正控制动画总时长。
// 下限保留 MIN_COARSE_TAIL_MS，确保短动画下 tail planner 仍有足够预算收敛。
export function tailBudgetMs(): number {
	return Math.max(
		MIN_COARSE_TAIL_MS,
		state.time + COARSE_WRITE_SETTLE_RESERVE_MS,
	);
}

export function maxBacklogPx(): number {
	const activeDrainBudget = tailBudgetMs() - COARSE_WRITE_SETTLE_RESERVE_MS;
	return (
		MAX_COARSE_SPEED_PX_PER_MS * activeDrainBudget -
		COARSE_DROPPED_FRAME_LOSS_PX
	);
}

// SCROLL_LIMITS 只保留按帧约束和静态派生量（与 animationTime 无关）。
// 按时长约束通过 tailBudgetMs()/maxBacklogPx() 函数访问，跟随 state.time 动态变化。
export const SCROLL_LIMITS = Object.freeze({
	maxSpeedPxPerMs: MAX_COARSE_SPEED_PX_PER_MS,
	maxFrameDisplacementPx: MAX_COARSE_FRAME_DISPLACEMENT_PX,
	minTailBudgetMs: MIN_COARSE_TAIL_MS,
	writeSettleReserveMs: COARSE_WRITE_SETTLE_RESERVE_MS,
	droppedFrameBudgetMs: COARSE_DROPPED_FRAME_BUDGET_MS,
	droppedFrameLossPx: COARSE_DROPPED_FRAME_LOSS_PX,
});
export const COARSE_SCROLL_LIMITS = SCROLL_LIMITS;

function now(): number {
	return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function isLiveTarget(target: Element | Window, deltaY: number): boolean {
	if (deltaY) {
		return (
			readAnimatableScrollTarget(target, deltaY, targetMetrics) &&
			targetMetrics.capacityY > SCROLL_POSITION_EPSILON
		);
	}
	return target instanceof Window ||
		(target.isConnected && ANIMATABLE_OVERFLOW.has(getComputedStyle(target).overflowY));
}

function responseRate(normalizedAge: number): number {
	if (state.easing === 'ease-out') return 10 - 4 * normalizedAge;
	if (state.easing === 'ease') return 3 + 9 * normalizedAge * normalizedAge;
	return LOG2_10;
}

function coarsePulseResponse(): number {
	// Keep the storage-compatible 1..10 control centered on the historical
	// default while giving it one bounded meaning across every coarse easing:
	// higher values tighten the response trajectory without changing distance,
	// the physical frame cap, or the tail deadline.
	return 0.75 + state.pulseScale / 16;
}

function consumeApplied(remaining: number, applied: number): number {
	if (!remaining || !applied || Math.sign(remaining) !== Math.sign(applied)) {
		return remaining;
	}
	const next = remaining - applied;
	if (Math.sign(next) !== Math.sign(remaining)) {
		return 0;
	}
	return next;
}

function reconcilePendingVerticalWrite(
	positionY: number,
	timestamp: number,
): boolean {
	const requested = state.pendingWriteY;
	if (!requested) return true;

	const observed = positionY - state.writeOriginY;
	if (observed && Math.sign(observed) === Math.sign(requested)) {
		// Browser pixel quantization may move up to half a CSS pixel beyond the
		// request. Larger same-direction page movement is external and must not
		// consume HALO's remaining displacement.
		const credited = Math.sign(observed) * Math.min(
			Math.abs(observed),
			Math.abs(requested) + OBSERVED_WRITE_TOLERANCE,
		);
		state.carryY -= credited;
		state.pendingWriteY = 0;
		state.pendingWriteStartedAt = null;
	} else if (Math.abs(requested) <= COMPLETION_RESIDUAL_EPSILON) {
		// Quantized targets may ignore a subpixel write. Release only this
		// in-flight attempt so logical carry can accumulate to a visible write.
		state.pendingWriteY = 0;
		state.pendingWriteStartedAt = null;
	} else if (
		state.pendingWriteStartedAt !== null &&
		timestamp - state.pendingWriteStartedAt >= WRITE_OBSERVATION_TIMEOUT_MS
	) {
		return false;
	}
	return true;
}

function writeVertical(
	target: Element | Window,
	positionY: number,
	deltaY: number,
	trackObservation: boolean,
	timestamp: number,
): void {
	if (target instanceof Window) {
		windowVerticalWriteOptions.top = deltaY;
		window.scrollBy(windowVerticalWriteOptions);
	} else {
		target.scrollTop = positionY + deltaY;
	}
	if (trackObservation) {
		state.writeOriginY = positionY;
		state.pendingWriteY = deltaY;
		state.pendingWriteStartedAt = timestamp;
	}
}

function physicalResidualY(): number {
	return state.remainingY + state.carryY;
}

function fineTimeConstant(): number {
	// 移除 MAX_FINE_TIME_CONSTANT_MS 上限，让触控板动画时长跟随 animationTime。
	// MAX_FINE_FRAME_RESPONSE=0.8 仍约束单帧响应，按帧性能不受影响。
	return Math.max(MIN_FINE_TIME_CONSTANT_MS, state.time * FINE_TIME_RATIO);
}

function coarseSpringOmega(): number {
	return (
		COARSE_SPRING_SCALE *
		state.coarseResponseMultiplierY /
		state.time *
		coarsePulseResponse()
	);
}

function advanceCoarseResponse(frameDelta: number): void {
	const difference =
		state.coarseResponseTargetY -
		state.coarseResponseMultiplierY;
	if (!difference) return;
	if (Math.abs(difference) < 0.001) {
		state.coarseResponseMultiplierY = state.coarseResponseTargetY;
		return;
	}
	const response =
		1 -
		Math.exp(-frameDelta / COARSE_RESPONSE_TRANSITION_MS);
	state.coarseResponseMultiplierY += difference * response;
}

function clampCoarseVelocity(): void {
	if (!state.remainingY || Math.sign(state.velocityY) !== Math.sign(state.remainingY)) {
		state.velocityY = 0;
		return;
	}
	state.velocityY = Math.sign(state.velocityY) * Math.min(
		Math.abs(state.velocityY),
		SCROLL_LIMITS.maxSpeedPxPerMs,
	);
}

function minimumCoarsePlanningDisplacement(
	previousTime: number,
	frameDelta: number,
	remainingMagnitude: number,
): number {
	if (state.coarseTailDeadline === null) return 0;
	const planningDeadline =
		state.coarseTailDeadline -
		SCROLL_LIMITS.writeSettleReserveMs;
	const futureDrainTime = Math.max(
		0,
		planningDeadline - (previousTime + frameDelta),
	);
	const futureDrainCapacity =
		SCROLL_LIMITS.maxSpeedPxPerMs *
		futureDrainTime;
	return Math.max(0, remainingMagnitude - futureDrainCapacity);
}

function advanceLogicalVertical(timestamp: number): number {
	const previousTime = state.lastDynamicsTime;
	if (previousTime === null) {
		state.lastDynamicsTime = timestamp;
		return 0;
	}
	const frameDelta = Math.max(0, timestamp - previousTime);
	if (!frameDelta) return 0;
	state.lastDynamicsTime = timestamp;
	state.activeFrameAge = Math.min(
		state.time,
		state.activeFrameAge + frameDelta,
	);
	if (!state.remainingY) {
		state.velocityY = 0;
		return frameDelta;
	}
	if (state.inputMode === 'coarse') {
		advanceCoarseResponse(frameDelta);
	}

	const previousRemaining = state.remainingY;
	let nextRemaining = previousRemaining;
	let nextVelocity = state.velocityY;

	if (state.inputMode === 'fine') {
		const response = Math.min(
			MAX_FINE_FRAME_RESPONSE,
			1 - Math.exp(-frameDelta / fineTimeConstant()),
		);
		nextRemaining = previousRemaining * (1 - response);
		nextVelocity = 0;
	} else if (state.easing === 'spring') {
		const omega = coarseSpringOmega();
		const error = -previousRemaining;
		const coefficient = state.velocityY + omega * error;
		const decay = Math.exp(-omega * frameDelta);
		const nextError =
			(error + coefficient * frameDelta) *
			decay;
		nextRemaining = -nextError;
		nextVelocity = (
			state.velocityY -
			omega * coefficient * frameDelta
		) * decay;
		if (
			!nextRemaining ||
			Math.sign(nextRemaining) !== Math.sign(previousRemaining)
		) {
			nextRemaining = 0;
			nextVelocity = 0;
		}
	} else {
		const normalizedAge = Math.min(1, state.activeFrameAge / state.time);
		const response = 1 - Math.exp(
			-responseRate(normalizedAge) *
				state.coarseResponseMultiplierY *
				coarsePulseResponse() *
				frameDelta /
				state.time,
		);
		nextRemaining = previousRemaining * (1 - response);
		nextVelocity = 0;
	}

	let plannedY = previousRemaining - nextRemaining;
	if (state.inputMode === 'fine') {
		const maxPlannedY =
			Math.abs(previousRemaining) * MAX_FINE_FRAME_RESPONSE;
		if (Math.abs(plannedY) > maxPlannedY) {
			plannedY = Math.sign(plannedY) * maxPlannedY;
			nextRemaining = previousRemaining - plannedY;
		}
	} else {
		const unconstrainedPlannedY = plannedY;
		const requiredPlannedY = minimumCoarsePlanningDisplacement(
			previousTime,
			frameDelta,
			Math.abs(previousRemaining),
		);
		const maximumPlannedY = Math.min(
			Math.abs(previousRemaining),
			SCROLL_LIMITS.maxSpeedPxPerMs * frameDelta,
			SCROLL_LIMITS.maxFrameDisplacementPx,
		);
		plannedY = Math.sign(previousRemaining) * Math.min(
			maximumPlannedY,
			Math.max(Math.abs(plannedY), requiredPlannedY),
		);
		nextRemaining = previousRemaining - plannedY;
		if (
			frameDelta > 0 &&
			Math.abs(plannedY) > Math.abs(unconstrainedPlannedY)
		) {
			nextVelocity =
				Math.sign(plannedY) *
				Math.max(
					Math.abs(nextVelocity),
					Math.abs(plannedY) / frameDelta,
				);
		}
	}

	state.remainingY = nextRemaining;
	state.velocityY = nextVelocity;
	if (state.inputMode === 'coarse') clampCoarseVelocity();
	state.carryY += plannedY;
	return frameDelta;
}

function processHorizontalStep(
	target: Element | Window,
	response: number,
): void {
	if (!state.remainingX) return;
	const requestedX = state.remainingX * response;
	if (!requestedX) return;

	if (target instanceof Window) {
		const beforeX = window.scrollX;
		window.scrollBy(requestedX, 0);
		state.remainingX = consumeApplied(state.remainingX, window.scrollX - beforeX);
		return;
	}

	const beforeX = target.scrollLeft;
	target.scrollLeft = beforeX + requestedX;
	state.remainingX = consumeApplied(state.remainingX, target.scrollLeft - beforeX);
}

function finishIfWithinPixel(
	target: Element | Window,
	metrics: ScrollTargetMetrics | null,
	timestamp: number,
): boolean {
	const residualY = physicalResidualY();
	const verticalDone =
		state.directionY === 0 ||
		Math.abs(residualY) <= COMPLETION_RESIDUAL_EPSILON;
	const horizontalDone =
		state.directionX === 0 ||
		Math.abs(state.remainingX) <= COMPLETION_RESIDUAL_EPSILON;
	if (!verticalDone || !horizontalDone) return false;
	if (state.pendingWriteY) return false;

	// Preserve exact fractional movement when the target supports it. Integer
	// scroll positions may ignore or round this final subpixel write, which is
	// already within the browser-observation tolerance.
	if (
		metrics &&
		residualY &&
		Math.sign(residualY) === state.directionY &&
		metrics.capacityY > 0
	) {
		const finalY = Math.sign(residualY) * Math.min(
			Math.abs(residualY),
			metrics.capacityY,
		);
		writeVertical(target, metrics.positionY, finalY, false, timestamp);
	}
	clearQueue();
	return true;
}

function abortQueue(): void {
	const onOwnershipLost = state.onOwnershipLost;
	clearQueue();
	onOwnershipLost?.();
}

function processStep(timestamp: number): void {
	state.frame = null;
	const target = state.target;
	if (!target) {
		abortQueue();
		return;
	}

	let metrics: ScrollTargetMetrics | null = null;
	if (state.directionY) {
		if (
			!readAnimatableScrollTarget(
				target,
				state.directionY,
				targetMetrics,
			) ||
			targetMetrics.target !== target
		) {
			abortQueue();
			return;
		}
		metrics = targetMetrics;
		if (!reconcilePendingVerticalWrite(metrics.positionY, timestamp)) {
			abortQueue();
			return;
		}
		if (metrics.capacityY <= SCROLL_POSITION_EPSILON) {
			abortQueue();
			return;
		}
	} else if (!isLiveTarget(target, 0)) {
		abortQueue();
		return;
	}

	const previousFrameTime = state.lastFrameTime ?? timestamp;
	const displayFrameDelta = Math.max(0, timestamp - previousFrameTime);
	state.lastFrameTime = timestamp;
	const frameDelta = advanceLogicalVertical(timestamp);
	if (state.remainingX) {
		const horizontalResponse = Math.min(
			MAX_COARSE_FRAME_RESPONSE,
			1 - Math.exp(-LOG2_10 * frameDelta / state.time),
		);
		processHorizontalStep(target, horizontalResponse);
	}
	if (finishIfWithinPixel(target, metrics, timestamp)) return;

	if (state.directionY && metrics) {
		const writableY = Math.sign(state.carryY) === state.directionY
			? state.carryY
			: 0;
		if (!state.pendingWriteY && writableY) {
			const physicalFrameBudget = Math.min(
				SCROLL_LIMITS.maxSpeedPxPerMs * displayFrameDelta,
				SCROLL_LIMITS.maxFrameDisplacementPx,
			);
			const requestedY = Math.sign(writableY) * Math.min(
				Math.abs(writableY),
				metrics.capacityY,
				physicalFrameBudget,
			);
			const hitVerticalBoundary =
				metrics.capacityY + 0.01 < Math.abs(writableY) &&
				Math.abs(requestedY) + 0.01 >= metrics.capacityY;
			if (requestedY) {
				writeVertical(
					target,
					metrics.positionY,
					requestedY,
					true,
					timestamp,
				);
			}
			if (hitVerticalBoundary) {
				abortQueue();
				return;
			}
		}
	}

	state.frame = requestAnimationFrame(processStep);
}

export function configure(time: number, easing: EasingType, pulseScale = 4): void {
	state.time = Math.min(2000, Math.max(50, time));
	state.easing = easing;
	state.pulseScale = Math.min(10, Math.max(1, pulseScale));
}

export function scrollTo(
	target: Element | Window,
	x: number,
	y: number,
	admission?: ScrollAdmission,
	inputMode: ScrollInputMode = 'coarse',
	presentationTimestamp = now(),
	responseMultiplier = 1,
): boolean {
	if ((!x && !y) || !Number.isFinite(x) || !Number.isFinite(y)) return false;

	const timestamp = Number.isFinite(presentationTimestamp)
		? presentationTimestamp
		: now();
	const usesRouteAdmission =
		Boolean(y) &&
		matchesScrollAdmission(admission, target, y);
	const canonicalTarget = usesRouteAdmission
		? target
		: canonicalizeScrollTarget(target);
	const directionX = Math.sign(x);
	const directionY = Math.sign(y);
	const targetChanged = state.target !== null && state.target !== canonicalTarget;
	const directionChanged =
		(state.directionX !== 0 && directionX !== 0 && state.directionX !== directionX) ||
		(state.directionY !== 0 && directionY !== 0 && state.directionY !== directionY);
	const inputModeChanged =
		state.target !== null &&
		state.inputMode !== inputMode;
	const promotesCurrentGesture =
		inputModeChanged &&
		state.inputMode === 'fine' &&
		inputMode === 'coarse' &&
		!targetChanged &&
		!directionChanged;

	// A displacement is owned by the target that admitted it. It must never be
	// replayed into a newly hovered nested container.
	if (
		targetChanged ||
		directionChanged ||
		(inputModeChanged && !promotesCurrentGesture)
	) clearQueue();

	let capacityY = Number.POSITIVE_INFINITY;
	let positionY = 0;
	if (y && usesRouteAdmission && admission) {
		capacityY = admission.capacityY;
		positionY = admission.positionY;
	} else if (y) {
		if (
			!readAnimatableScrollTarget(
				canonicalTarget,
				y,
				targetMetrics,
			) ||
			targetMetrics.capacityY <= SCROLL_POSITION_EPSILON
		) {
			clearQueue();
			return false;
		}
		capacityY = targetMetrics.capacityY;
		positionY = targetMetrics.positionY;
	} else if (!isLiveTarget(canonicalTarget, 0)) {
		clearQueue();
		return false;
	}

	if (state.target === canonicalTarget && state.pendingWriteY && y) {
		if (!reconcilePendingVerticalWrite(positionY, timestamp)) {
			clearQueue();
			return false;
		}
	}

	if (state.target === canonicalTarget && state.lastDynamicsTime !== null) {
		advanceLogicalVertical(timestamp);
	}

	state.target = canonicalTarget;
	state.inputMode = inputMode;
	state.coarseResponseTargetY =
		inputMode === 'coarse' && Number.isFinite(responseMultiplier)
			? Math.min(
				MAX_COARSE_RESPONSE_MULTIPLIER,
				Math.max(1, responseMultiplier),
			)
			: 1;
	if (inputMode !== 'coarse') {
		state.coarseResponseMultiplierY = 1;
	}
	if (directionX) state.directionX = directionX;
	if (directionY) state.directionY = directionY;
	state.remainingX += x;

	if (directionY) {
		const currentResidual = physicalResidualY();
		const requestedResidual = currentResidual + y;
		const maximumResidual =
			Math.min(capacityY, maxBacklogPx());
		const boundedResidual = directionY * Math.min(
			Math.abs(requestedResidual),
			maximumResidual,
		);
		const acceptedDelta = boundedResidual - currentResidual;
		state.remainingY += acceptedDelta;
		state.coarseTailDeadline =
			inputMode === 'coarse'
				? timestamp + tailBudgetMs()
				: null;
		if (inputMode === 'coarse') clampCoarseVelocity();
	}

	if (state.frame === null) {
		state.lastDynamicsTime = timestamp;
		state.lastFrameTime = timestamp;
		state.activeFrameAge = 0;
		state.frame = requestAnimationFrame(processStep);
	}
	return true;
}

export function queueOwnedVerticalScroll(
	target: Element | Window,
	y: number,
	presentationTimestamp = now(),
	onOwnershipLost?: () => void,
): boolean {
	if (!y || !Number.isFinite(y)) return false;
	if (!(target instanceof Window) && !target.isConnected) return false;

	const timestamp = Number.isFinite(presentationTimestamp)
		? presentationTimestamp
		: now();
	const directionY = Math.sign(y);
	const targetChanged = state.target !== null && state.target !== target;
	const directionChanged =
		state.directionY !== 0 &&
		state.directionY !== directionY;
	if (targetChanged || directionChanged || state.inputMode !== 'fine') {
		clearQueue();
	}

	state.target = target;
	state.inputMode = 'fine';
	state.onOwnershipLost = onOwnershipLost ?? null;
	state.directionY = directionY;
	const currentResidual = physicalResidualY();
	const requestedResidual = currentResidual + y;
	const boundedResidual =
		directionY *
		Math.min(
			Math.abs(requestedResidual),
			maxBacklogPx(),
		);
	state.remainingY += boundedResidual - currentResidual;
	state.coarseTailDeadline = null;

	if (state.frame === null) {
		state.lastDynamicsTime = timestamp;
		state.lastFrameTime = timestamp;
		state.activeFrameAge = 0;
		state.frame = requestAnimationFrame(processStep);
	}
	return true;
}

export function clearQueue(): void {
	if (state.frame !== null) cancelAnimationFrame(state.frame);
	state.frame = null;
	state.target = null;
	state.directionX = 0;
	state.directionY = 0;
	state.remainingX = 0;
	state.remainingY = 0;
	state.carryY = 0;
	state.pendingWriteY = 0;
	state.writeOriginY = 0;
	state.pendingWriteStartedAt = null;
	state.velocityY = 0;
	state.inputMode = 'coarse';
	state.coarseResponseMultiplierY = 1;
	state.coarseResponseTargetY = 1;
	state.coarseTailDeadline = null;
	state.lastDynamicsTime = null;
	state.lastFrameTime = null;
	state.activeFrameAge = 0;
	state.onOwnershipLost = null;
	targetMetrics.target = null as unknown as Element;
	targetMetrics.positionY = 0;
	targetMetrics.maxY = 0;
	targetMetrics.capacityY = 0;
}
