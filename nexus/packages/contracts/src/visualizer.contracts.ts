// goal: own visualizer observation subscriptions and frame wire shapes

import {
	isCaptureAdmission,
	type CaptureAdmission,
} from './capture-admission.contracts.js';
import {
	hasOnlyProtocolKeys,
	isNonNegativeInteger,
	isPositiveInteger,
	isProtocolRecord,
} from './spectra.protocol-primitives.js';

export interface VisualizerBatchPayload {
	subscriberId: string;
	generation: number;
	tabIds: number[];
	// Only the visible foreground card may request a transient analysis source.
	// Background cards remain passive consumers of processors that already exist.
	captureTabId: number | null;
}

export interface VisualizerBatchResult {
	subscriberId: string;
	generation: number;
	frames: Record<string, number[] | null>;
}

export interface VisualizerFrameResult {
	buffer: number[] | null;
}

export type AudioVisualizerDemandPayload =
	| {
		subscriberId: string;
		enabled: true;
		// Retired v2 field; observation no longer grants Capture authority.
		admission?: CaptureAdmission;
	}
	| {
		subscriberId: string;
		enabled: false;
		admission?: never;
	};

const VISUALIZER_BATCH_PAYLOAD_KEYS = new Set([
	'subscriberId', 'generation', 'tabIds', 'captureTabId',
]);
const VISUALIZER_BATCH_RESULT_KEYS = new Set(['subscriberId', 'generation', 'frames']);
const VISUALIZER_FRAME_RESULT_KEYS = new Set(['buffer']);
const VISUALIZER_DEMAND_ENABLED_KEYS = new Set(['subscriberId', 'enabled', 'admission']);
const VISUALIZER_DEMAND_DISABLED_KEYS = new Set(['subscriberId', 'enabled']);
const TAB_ID_KEY = /^[1-9]\d*$/u;

function isSubscriberId(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

function isVisualizerFrame(value: unknown): value is number[] | null {
	return value === null || (
		Array.isArray(value)
		&& value.length <= 4096
		&& value.every((sample) => Number.isInteger(sample) && sample >= 0 && sample <= 255)
	);
}

export function isVisualizerBatchPayload(value: unknown): value is VisualizerBatchPayload {
	if (!isProtocolRecord(value)
		|| !hasOnlyProtocolKeys(value, VISUALIZER_BATCH_PAYLOAD_KEYS)
		|| !isSubscriberId(value.subscriberId)
		|| !isNonNegativeInteger(value.generation)
		|| !Array.isArray(value.tabIds)
		|| value.tabIds.length > 64
		|| !(value.captureTabId === null || isPositiveInteger(value.captureTabId))) return false;
	const unique = new Set<number>();
	for (const tabId of value.tabIds) {
		if (!isPositiveInteger(tabId) || unique.has(tabId)) return false;
		unique.add(tabId);
	}
	return value.captureTabId === null || unique.has(value.captureTabId);
}

export function isVisualizerBatchResult(value: unknown): value is VisualizerBatchResult {
	if (!isProtocolRecord(value)
		|| !hasOnlyProtocolKeys(value, VISUALIZER_BATCH_RESULT_KEYS)
		|| !isSubscriberId(value.subscriberId)
		|| !isNonNegativeInteger(value.generation)
		|| !isProtocolRecord(value.frames)) return false;
	return Object.entries(value.frames).every(([tabId, frame]) => (
		TAB_ID_KEY.test(tabId) && isVisualizerFrame(frame)
	));
}

export function isVisualizerFrameResult(value: unknown): value is VisualizerFrameResult {
	return isProtocolRecord(value)
		&& hasOnlyProtocolKeys(value, VISUALIZER_FRAME_RESULT_KEYS)
		&& isVisualizerFrame(value.buffer);
}

export function isAudioVisualizerDemandPayload(
	value: unknown,
): value is AudioVisualizerDemandPayload {
	if (!isProtocolRecord(value) || !isSubscriberId(value.subscriberId)) return false;
	if (value.enabled === true) {
		return hasOnlyProtocolKeys(value, VISUALIZER_DEMAND_ENABLED_KEYS)
			&& (value.admission === undefined
				|| isCaptureAdmission(value.admission) && value.admission.kind === 'capture-start');
	}
	return value.enabled === false
		&& hasOnlyProtocolKeys(value, VISUALIZER_DEMAND_DISABLED_KEYS);
}
