// goal: execute momentary, target-bound control algorithms with structured actual ACKs

import {
	SPECTRA_PROTOCOL_VERSION,
	isSpectraRequestEnvelope,
	rpcFailure,
	rpcSuccess,
	type ABLoopState,
	type ControlField,
	type ControlFieldStates,
	type ControlOperation,
	type ControlOperationAck,
	type ControlOperationIntent,
	type ControlOperationResult,
	type ControlStrategy,
	type MediaTarget,
} from '@nexus/contracts';
import { getActiveMediaRegistry, type MediaRegistry } from '../core/media-registry';
import {
	ContentLifecycleError,
	isContentLifecycleError,
} from '../core/content-runtime-context';
import { showToast } from '../ui/toast';
import { clearABLoop, getABState, setPointA, setPointB, skipABLoop } from '../video/ab-loop';
import { takeScreenshot, verifyScreenshotTarget } from '../video/video-transform';
import {
	addMarker,
	jumpAdjacentMarker,
	jumpToMarker,
	removeMarker,
} from '../video/time-marker';
import type { NativeMediaExecutor } from './native-media-executor';
import { isContentActiveVideoOperation } from './content-control-policy';

function abLoopState(target: ControlOperationIntent['target']): ABLoopState {
	const state = getABState(target);
	return { pointA: state.pointA, pointB: state.pointB, enabled: state.looping };
}

function operationField(
	intent: ControlOperationIntent,
	field: ControlField,
	actual: unknown,
	strategy: ControlStrategy,
	controlled = true,
): ControlFieldStates {
	return {
		[field]: {
			desired: actual,
			actual,
			revision: intent.baseRevision + 1,
			phase: 'applied',
			strategy,
			coverage: 'active-target',
			controlled,
			intentId: intent.operationId,
			lastError: null,
		},
	} as ControlFieldStates;
}

function ack<O extends ControlOperation>(
	intent: ControlOperationIntent<O>,
	strategy: ControlStrategy,
	result: ControlOperationResult<O>,
	fields: ControlFieldStates = {},
	target: ControlOperationAck<O>['target'] = intent.target,
): ControlOperationAck<O> {
	return {
		operationId: intent.operationId,
		tabId: intent.tabId,
		documentId: intent.documentId,
		generation: intent.generation,
		revision: intent.baseRevision + 1,
		target,
		operation: intent.operation,
		strategy,
		coverage: 'active-target',
		fields,
		result,
	} as ControlOperationAck<O>;
}

type ResolvedOperationTarget = NonNullable<ReturnType<MediaRegistry['resolve']>>;

function assertOperationTargetCurrent(
	registry: ReturnType<typeof getActiveMediaRegistry>,
	resolved: ResolvedOperationTarget | null,
	videoScoped: boolean,
): ResolvedOperationTarget | null {
	if (!resolved || !registry) return resolved;
	const current = videoScoped
		? registry.resolveVideo(resolved.target)
		: registry.resolve(resolved.target);
	if (!current || current.element !== resolved.element) {
		throw new ContentLifecycleError(
			'stale-media-source',
			'The operation target changed before its asynchronous result committed',
		);
	}
	return current;
}

export async function executeControlOperation(
	originalIntent: ControlOperationIntent,
	nativeExecutor: NativeMediaExecutor,
): Promise<ControlOperationAck> {
	const registry = getActiveMediaRegistry();
	const videoScoped = isContentActiveVideoOperation(originalIntent.operation);
	const resolved = (videoScoped
		? registry?.resolveVideo(originalIntent.target)
		: registry?.resolve(originalIntent.target))?.target
		?? null;
	const resolvedElement = resolved
		? (videoScoped ? registry?.resolveVideo(resolved)?.element : registry?.resolve(resolved)?.element)
			?? null
		: null;
	// Source retirement is a hard operation boundary.  Keep the exact element and
	// target captured at admission, then validate both after every awaited media
	// operation before producing an ACK.
	const operationTarget = resolved ?? (originalIntent.operation === 'ab-clear' ? originalIntent.target : null);
	const operationResolved = resolved && resolvedElement
		? { target: resolved, element: resolvedElement }
		: null;
	const intent = { ...originalIntent, target: operationTarget } as ControlOperationIntent;
	const currentTarget = (): MediaTarget | null => {
		const current = assertOperationTargetCurrent(registry, operationResolved, videoScoped);
		return current?.target ?? operationTarget;
	};
	switch (intent.operation) {
		case 'restore-page-settings': {
			const released = await nativeExecutor.releasePageSettings(intent);
			return ack(intent, 'extension-state', {
				releasedFields: released.releasedFields,
			}, released.fields, currentTarget());
		}
		case 'frame-step': {
			const stepped = await nativeExecutor.stepFrame(intent);
			return ack(intent, 'dom-native', stepped.result, stepped.fields, currentTarget());
		}
		case 'screenshot': {
			const result = await takeScreenshot(intent.target, intent.generation);
			return ack(intent, 'chrome-native', result, {}, currentTarget());
		}
		case 'marker-add': {
			const added = addMarker(intent.payload.label, intent.target);
			if (!added) throw new Error('No active media source is available for a marker');
			return ack(intent, 'extension-state', {
				marker: added.marker,
				remaining: added.remaining,
			}, {}, currentTarget());
		}
		case 'marker-remove': {
			const removed = removeMarker(intent.payload.id, intent.target);
			if (!removed.removed) {
				throw new Error('The marker does not exist on the selected media source');
			}
			return ack(intent, 'extension-state', {
				removed: true,
				remaining: removed.remaining,
			}, {}, currentTarget());
		}
		case 'marker-jump': {
			const result = await jumpToMarker(intent.payload.id, intent.target);
			if (!result.jumped) throw new Error('The marker does not exist on the selected media source');
			const fields = result.jumped
				? operationField(intent, 'currentTime', result.time, 'dom-native')
				: {};
			return ack(intent, 'dom-native', result, fields, currentTarget());
		}
		case 'marker-jump-previous':
		case 'marker-jump-next': {
			const adjacent = await jumpAdjacentMarker(intent.operation === 'marker-jump-next', intent.target);
			if (!adjacent) throw new Error('No adjacent marker exists on the selected media source');
			const currentTime = adjacent.actualTime;
			const fields = currentTime === null
				? {}
				: operationField(intent, 'currentTime', currentTime, 'dom-native');
			return ack(intent, 'dom-native', {
				jumped: true,
				actualTime: currentTime,
				marker: adjacent.marker,
			}, fields, currentTarget());
		}
		case 'ab-set-a': {
			const pointA = setPointA(intent.target);
			if (pointA === null) throw new Error('No active media source is available for A/B');
			const abLoop = abLoopState(intent.target);
			return ack(intent, 'extension-state', { abLoop }, operationField(
				intent, 'abLoop', abLoop, 'extension-state', true,
			), currentTarget());
		}
		case 'ab-set-b': {
			const result = setPointB(intent.target);
			if (result.pointB === null || !result.looping) {
				throw new Error('Point B must be at least 0.1 seconds after Point A on the same media source');
			}
			const abLoop = abLoopState(intent.target);
			return ack(intent, 'extension-state', { abLoop }, operationField(
				intent, 'abLoop', abLoop, 'extension-state', true,
			), currentTarget());
		}
		case 'ab-clear': {
			const cleared = clearABLoop(intent.target);
			const abLoop = abLoopState(intent.target);
			return ack(intent, 'extension-state', { abLoop, cleared }, operationField(
				intent, 'abLoop', abLoop, 'extension-state', false,
			), currentTarget());
		}
		case 'ab-skip': {
			const currentTime = await skipABLoop(intent.target);
			if (currentTime === null) {
				throw new Error('No complete A/B loop exists on the selected media source');
			}
			const fields = operationField(intent, 'currentTime', currentTime, 'dom-native');
			return ack(intent, 'dom-native', {
				abLoop: abLoopState(intent.target),
				skipped: true,
				currentTime,
			}, fields, currentTarget());
		}
		case 'show-info': {
			const media = nativeExecutor.readMediaSummary(intent.target);
			const ab = getABState(intent.target);
			const abLabel = ab.pointA !== null && ab.pointB !== null
				? ` · A/B ${ab.pointA.toFixed(1)}–${ab.pointB.toFixed(1)}s`
				: '';
			if (intent.source === 'hotkey') {
				showToast(`${media.playing ? 'Playing' : 'Paused'} · ${media.speed.toFixed(2)}x${abLabel}`);
			}
			// The selected media is read only to compose the OSD. The document-scoped
			// operation executes no media writer, so its ACK cannot borrow that target.
			return ack(intent, 'observe', { shown: true }, {}, null);
		}
		default:
			throw new Error(`Operation ${intent.operation} must execute in Background or through field intents`);
	}
}

export function registerControlOperationExecutor(nativeExecutor: NativeMediaExecutor): () => void {
	const listener = (
		message: unknown,
		sender: chrome.runtime.MessageSender,
		sendResponse: (response?: unknown) => void,
	): boolean => {
		if (!message || typeof message !== 'object') return false;
		const candidate = message as { protocolVersion?: unknown; type?: unknown };
		if (candidate.protocolVersion !== SPECTRA_PROTOCOL_VERSION
			|| (candidate.type !== 'spectra.control.operation.execute'
				&& candidate.type !== 'spectra.screenshot.target.verify')) return false;
		if (sender.id !== chrome.runtime.id) {
			sendResponse(rpcFailure('forbidden', 'Control operation execution is extension-internal only'));
			return false;
		}
		if (!isSpectraRequestEnvelope(message)
			|| (message.type !== 'spectra.control.operation.execute'
				&& message.type !== 'spectra.screenshot.target.verify')) {
			sendResponse(rpcFailure('invalid_request', 'Malformed control operation intent'));
			return false;
		}
		if (message.type === 'spectra.screenshot.target.verify') {
			if (!verifyScreenshotTarget(message.payload.captureToken)) {
				sendResponse(rpcFailure(
					'screenshot_target_changed',
					'The active video source or geometry changed during capture',
					true,
				));
				return false;
			}
			sendResponse(rpcSuccess({ valid: true as const }));
			return false;
		}
		void executeControlOperation(message.payload, nativeExecutor).then(
			(result) => sendResponse(rpcSuccess(result)),
			(error) => {
				const lifecycle = isContentLifecycleError(error);
				sendResponse(rpcFailure(
					lifecycle ? error.code : 'control_operation_failed',
					error instanceof Error ? error.message : String(error),
					lifecycle ? error.retryable : true,
				));
			},
		);
		return true;
	};
	chrome.runtime.onMessage.addListener(listener);
	return () => chrome.runtime.onMessage.removeListener(listener);
}
