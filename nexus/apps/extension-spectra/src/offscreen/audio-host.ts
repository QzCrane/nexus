// goal: acknowledged, revisioned tab-capture processing on one sparse shared graph

import {
	AudioGraphRouter,
	type AudioGraphSnapshot,
} from '@nexus/audio-engine';
import type {
	AudioProcessorConfig,
	OffscreenAudioEvent,
	OffscreenAudioRequest,
	OffscreenAudioRequestType,
	OffscreenAudioResult,
	OffscreenHostResponse,
} from '@nexus/contracts';

export interface AudioHostDescription {
	tabId: number;
	generation: number;
	controlRevision: number;
	graphSignature: string;
	normalizedActualConfig: AudioProcessorConfig;
}

interface AudioProcessor {
	tabId: number;
	generation: number;
	controlRevision: number;
	ctx: AudioContext;
	stream: MediaStream;
	source: MediaStreamAudioSourceNode;
	commitGate: GainNode;
	router: AudioGraphRouter;
	snapshot: AudioGraphSnapshot;
	vizDisposer: (() => void) | null;
	lastVizAt: number;
	lastVizFrame: number[] | null;
	trackEndedDisposers: Array<() => void>;
	disposePromise: Promise<void> | null;
}

type AudioIntentKind = 0 | 1 | 2;
const INTENT_START: AudioIntentKind = 0;
const INTENT_UPDATE: AudioIntentKind = 1;
const INTENT_STOP: AudioIntentKind = 2;

type AudioIntent = [generation: number, kind: AudioIntentKind, controlRevision: number];

export type AudioHostResult = OffscreenAudioResult;

const processors = new Map<number, AudioProcessor>();
const latestIntents = new Map<number, AudioIntent>();
const visualizerSubscriptions = new Set<number>();
const EMPTY_VISUALIZER_FRAME: { buffer: number[] | null } = { buffer: null };
const CAPTURE_GATE_SWITCH_LEAD_MS = 20;

function recordIntent(tabId: number, generation: number, kind: AudioIntentKind): AudioIntent {
	let current = latestIntents.get(tabId);
	if (!current || generation > current[0]) {
		current = [generation, kind, current?.[2] ?? 0];
		latestIntents.set(tabId, current);
	} else if (generation === current[0] && kind === INTENT_STOP) {
		current[1] = kind;
	}
	return current;
}

function recordControlRevision(tabId: number, controlRevision: number): void {
	const intent = latestIntents.get(tabId);
	if (intent) intent[2] = controlRevision;
}

function setImmediate(param: AudioParam, value: number, time: number): void {
	param.cancelScheduledValues(time);
	param.setValueAtTime(value, time);
}

function idleResult(tabId: number, generation: number, controlRevision: number): AudioHostResult {
	return {
		ok: true,
		tabId,
		generation,
		controlRevision,
		phase: 'idle',
		contextState: 'closed',
		graphSignature: 'none',
		normalizedActualConfig: null,
	};
}

function activeResult(processor: AudioProcessor): AudioHostResult {
	if (processor.ctx.state !== 'running') {
		return errorResult(
			processor.tabId,
			processor.generation,
			processor.controlRevision,
			`Capture AudioContext is ${processor.ctx.state}`,
			'capture_context_not_running',
		);
	}
	return {
		ok: true,
		tabId: processor.tabId,
		generation: processor.generation,
		controlRevision: processor.controlRevision,
		phase: 'active',
		contextState: 'running',
		graphSignature: processor.snapshot.graphSignature,
		normalizedActualConfig: processor.snapshot.normalizedActualConfig,
	};
}

function describeCurrentState(tabId: number, fallbackGeneration: number): AudioHostResult {
	const processor = processors.get(tabId);
	if (processor) return activeResult(processor);
	const intent = latestIntents.get(tabId);
	const generation = Math.max(fallbackGeneration, intent?.[0] ?? 0);
	return idleResult(tabId, generation, intent?.[2] ?? 0);
}

function errorResult(
	tabId: number,
	generation: number,
	controlRevision: number,
	error: unknown,
	code = 'capture_start_failed',
): AudioHostResult {
	const message = error instanceof Error ? error.message : String(error);
	return {
		ok: false,
		tabId,
		generation,
		controlRevision,
		error: { code, message, retryable: true },
	};
}

function staleIntentResult(
	tabId: number,
	generation: number,
	controlRevision: number,
): AudioHostResult {
	return errorResult(
		tabId,
		generation,
		controlRevision,
		'Capture configuration belongs to a stopped generation',
		'stale_capture_intent',
	);
}

function ensureVisualizerSubscription(processor: AudioProcessor): void {
	if (!visualizerSubscriptions.has(processor.tabId) || processor.vizDisposer) return;
	processor.vizDisposer = processor.router.subscribeVisualizer();
}

function releaseVisualizerSubscription(processor: AudioProcessor): void {
	processor.vizDisposer?.();
	processor.vizDisposer = null;
	processor.lastVizFrame = null;
	processor.lastVizAt = 0;
}

function setVisualizerSubscriptions(tabIds: number[]): { subscribedTabIds: number[] } {
	visualizerSubscriptions.clear();
	for (const tabId of tabIds) visualizerSubscriptions.add(tabId);
	for (const processor of processors.values()) {
		if (visualizerSubscriptions.has(processor.tabId)) ensureVisualizerSubscription(processor);
		else releaseVisualizerSubscription(processor);
	}
	return { subscribedTabIds: [...visualizerSubscriptions].sort((left, right) => left - right) };
}

async function applyProcessorConfig(
	processor: AudioProcessor,
	config: AudioProcessorConfig,
	controlRevision: number,
	commit = true,
): Promise<AudioGraphSnapshot> {
	if (controlRevision < processor.controlRevision) return processor.snapshot;
	const snapshot = await processor.router.apply(config, {
		requireRunning: true,
	});
	if (commit) {
		processor.controlRevision = controlRevision;
		processor.snapshot = snapshot;
		recordControlRevision(processor.tabId, controlRevision);
	}
	return snapshot;
}

async function disposeProcessorResources(processor: AudioProcessor): Promise<void> {
	const failures: unknown[] = [];
	if (processors.get(processor.tabId) === processor) processors.delete(processor.tabId);
	try {
		releaseVisualizerSubscription(processor);
	} catch (error) {
		failures.push(error);
	}
	for (const dispose of processor.trackEndedDisposers) {
		try {
			dispose();
		} catch (error) {
			failures.push(error);
		}
	}
	processor.trackEndedDisposers.length = 0;
	try {
		setImmediate(processor.commitGate.gain, 0, processor.ctx.currentTime);
	} catch (error) {
		failures.push(error);
	}
	for (const track of processor.stream.getTracks()) {
		try {
			track.stop();
		} catch (error) {
			failures.push(error);
		}
	}
	try {
		await processor.router.dispose(true);
	} catch (error) {
		failures.push(error);
	}
	try {
		processor.source.disconnect();
	} catch (error) {
		failures.push(error);
	}
	try {
		processor.commitGate.disconnect();
	} catch (error) {
		failures.push(error);
	}
	if (processor.ctx.state !== 'closed') {
		try {
			await processor.ctx.close();
		} catch (error) {
			failures.push(error);
		}
	}
	if (failures.length > 0) {
		// The processor has already been retired from the host and every shutdown
		// operation has been attempted. Rejecting here would make Background keep
		// projecting an active processor and lease even though the host can no
		// longer address it. Report cleanup diagnostics without falsifying the
		// authoritative idle transition.
		console.error(
			'[SPECTRA] Audio processor disposal completed with cleanup failures',
			new AggregateError(failures),
		);
	}
}

function disposeProcessor(processor: AudioProcessor): Promise<void> {
	processor.disposePromise ??= disposeProcessorResources(processor);
	return processor.disposePromise;
}

function notifyProcessorEnded(processor: AudioProcessor): void {
	const runtime = typeof chrome === 'undefined' ? undefined : chrome.runtime;
	if (!runtime?.sendMessage) return;
	const event: OffscreenAudioEvent = {
		type: 'OFFSCREEN_AUDIO_ENDED',
		tabId: processor.tabId,
		generation: processor.generation,
	};
	void runtime.sendMessage(event).catch((error: unknown) => {
		console.warn('[SPECTRA] Failed to report ended capture processor', error);
	});
}

function observeTrackEnd(processor: AudioProcessor): void {
	for (const track of processor.stream.getTracks()) {
		const handleEnded = () => {
			if (processor.disposePromise) return;
			const wasCurrent = processors.get(processor.tabId) === processor;
			recordIntent(processor.tabId, processor.generation, INTENT_STOP);
			void disposeProcessor(processor).catch((error: unknown) => {
				console.error('[SPECTRA] Failed to dispose ended capture processor', error);
			}).finally(() => {
				if (wasCurrent) notifyProcessorEnded(processor);
			});
		};
		track.addEventListener('ended', handleEnded, { once: true });
		processor.trackEndedDisposers.push(() => track.removeEventListener('ended', handleEnded));
	}
}

async function startCapture(
	tabId: number,
	streamId: string,
	config: AudioProcessorConfig,
	generation: number,
	controlRevision: number,
): Promise<AudioHostResult> {
	const intent = recordIntent(tabId, generation, INTENT_START);
	if (intent[0] !== generation || intent[1] !== INTENT_START) {
		const current = processors.get(tabId);
		return current
			? activeResult(current)
			: staleIntentResult(tabId, intent[0], controlRevision);
	}
	const existing = processors.get(tabId);
	if (existing) {
		if (existing.generation > generation) return activeResult(existing);
		if (existing.generation === generation) {
			await applyProcessorConfig(existing, config, controlRevision);
			return activeResult(existing);
		}
	}

	let stream: MediaStream | null = null;
	let ctx: AudioContext | null = null;
	let candidate: AudioProcessor | null = null;
	try {
		stream = await navigator.mediaDevices.getUserMedia({
			audio: {
				mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId },
			} as MediaTrackConstraints,
			video: false,
		});
		const audioTracks = stream.getAudioTracks();
		if (!audioTracks.some((track) => track.readyState !== 'ended')) {
			throw new Error('Tab capture returned no live audio track');
		}
		ctx = new AudioContext();
		const source = ctx.createMediaStreamSource(stream);
		const commitGate = ctx.createGain();
		setImmediate(commitGate.gain, 0, ctx.currentTime);
		commitGate.connect(ctx.destination);
		const graphRouter = new AudioGraphRouter(ctx, commitGate);
		graphRouter.connectSource(source);
		if (ctx.state === 'suspended') await ctx.resume();
		if (ctx.state !== 'running') throw new Error(`Capture AudioContext is ${ctx.state}`);
		const snapshot = await graphRouter.apply(config, {
			requireRunning: true,
		});
		candidate = {
			tabId,
			generation,
			controlRevision,
			ctx,
			stream,
			source,
			commitGate,
			router: graphRouter,
			snapshot,
			vizDisposer: null,
			lastVizAt: 0,
			lastVizFrame: null,
			trackEndedDisposers: [],
			disposePromise: null,
		};
		observeTrackEnd(candidate);
		const currentIntent = latestIntents.get(tabId);
		if (currentIntent?.[0] !== generation || currentIntent[1] !== INTENT_START) {
			await disposeProcessor(candidate);
			return describeCurrentState(tabId, generation);
		}

		const current = processors.get(tabId);
		if (current?.generation === generation) {
			await applyProcessorConfig(current, config, controlRevision);
			await disposeProcessor(candidate);
			return activeResult(current);
		}
		if (current && current.generation > generation) {
			await disposeProcessor(candidate);
			return activeResult(current);
		}

		// Candidate is connected and running before commit. Replacements schedule
		// both independent AudioContext gates for the same near-future wall-clock
		// boundary, avoiding a full-gain overlap without tearing down the stable
		// processor before the candidate is ready.
		if (current) {
			const leadSeconds = CAPTURE_GATE_SWITCH_LEAD_MS / 1_000;
			candidate.commitGate.gain.setValueAtTime(1, candidate.ctx.currentTime + leadSeconds);
			current.commitGate.gain.cancelScheduledValues(current.ctx.currentTime);
			current.commitGate.gain.setValueAtTime(0, current.ctx.currentTime + leadSeconds);
		} else {
			setImmediate(candidate.commitGate.gain, 1, candidate.ctx.currentTime);
		}
		processors.set(tabId, candidate);
		recordControlRevision(tabId, controlRevision);
		ensureVisualizerSubscription(candidate);
		if (current) {
			await new Promise<void>((resolve) => setTimeout(
				resolve,
				CAPTURE_GATE_SWITCH_LEAD_MS + 5,
			));
			await disposeProcessor(current);
		}
		return activeResult(candidate);
	} catch (error) {
		let failure: unknown = error;
		if (candidate) {
			try {
				await disposeProcessor(candidate);
			} catch (disposeError) {
				failure = new AggregateError(
					[error, disposeError],
					'Capture startup and processor cleanup both failed',
				);
			}
		}
		else {
			if (stream) for (const track of stream.getTracks()) track.stop();
			if (ctx && ctx.state !== 'closed') {
				try {
					await ctx.close();
				} catch (closeError) {
					failure = new AggregateError(
						[error, closeError],
						'Capture startup and AudioContext cleanup both failed',
					);
				}
			}
		}
		return errorResult(tabId, generation, controlRevision, failure);
	}
}

async function stopCapture(tabId: number, generation: number): Promise<AudioHostResult> {
	const intent = recordIntent(tabId, generation, INTENT_STOP);
	const processor = processors.get(tabId);
	if (!processor) return describeCurrentState(tabId, intent[0]);
	if (processor.generation > generation) return activeResult(processor);
	const controlRevision = processor.controlRevision;
	await disposeProcessor(processor);
	return idleResult(tabId, generation, controlRevision);
}

async function cancelPendingStart(
	tabId: number,
	generation: number,
	stopCommitted: boolean,
): Promise<AudioHostResult> {
	recordIntent(tabId, generation, INTENT_STOP);
	const processor = processors.get(tabId);
	if (stopCommitted && processor?.generation === generation) await disposeProcessor(processor);
	return describeCurrentState(tabId, generation);
}

function getVisualizerFrame(tabId: number): { buffer: number[] | null } {
	const processor = processors.get(tabId);
	if (!processor || !visualizerSubscriptions.has(tabId)) return EMPTY_VISUALIZER_FRAME;
	const now = performance.now();
	if (!processor.lastVizFrame || now - processor.lastVizAt >= 1_000 / 15) {
		const data = processor.router.getVisualizerData();
		if (!data) {
			processor.lastVizFrame = null;
		} else {
			const frame = processor.lastVizFrame && processor.lastVizFrame.length === data.length
				? processor.lastVizFrame
				: new Array<number>(data.length);
			for (let index = 0; index < data.length; index += 1) frame[index] = data[index] ?? 0;
			processor.lastVizFrame = frame;
		}
		processor.lastVizAt = now;
	}
	return { buffer: processor.lastVizFrame };
}

export function describeAudioHost(): AudioHostDescription[] {
	return [...processors.values()].map(({ tabId, generation, controlRevision, snapshot }) => ({
		tabId,
		generation,
		controlRevision,
		graphSignature: snapshot.graphSignature,
		normalizedActualConfig: snapshot.normalizedActualConfig,
	}));
}

export async function handleAudioHostMessage(
	message: OffscreenAudioRequest,
): Promise<OffscreenHostResponse<OffscreenAudioRequestType>> {
	switch (message.type) {
		case 'OFFSCREEN_AUDIO_START':
			return startCapture(
				message.tabId,
				message.streamId,
				message.config,
				message.generation,
				message.controlRevision ?? 0,
			);
		case 'OFFSCREEN_AUDIO_STOP':
			return stopCapture(message.tabId, message.generation);
		case 'OFFSCREEN_AUDIO_CANCEL_START':
			return cancelPendingStart(message.tabId, message.generation, message.stopCommitted);
		case 'OFFSCREEN_AUDIO_UPDATE': {
			const { tabId, generation, controlRevision: requestedControlRevision } = message;
			const controlRevision = requestedControlRevision ?? 0;
			const previousIntent = latestIntents.get(tabId);
			if (previousIntent?.[1] === INTENT_STOP && generation <= previousIntent[0]) {
				return staleIntentResult(tabId, previousIntent[0], controlRevision);
			}
			const processor = processors.get(tabId);
			if (!processor) {
				return errorResult(
					tabId,
					generation,
					controlRevision,
					'Capture is not active',
					'capture_not_active',
				);
			}
			if (generation < processor.generation || controlRevision < processor.controlRevision) {
				return activeResult(processor);
			}
			try {
				// The router ACK is the transaction prepare phase. Do not publish
				// generation/revision/snapshot or the update intent until that ACK
				// succeeds; a failed update must leave the previous STOP addressable.
				const snapshot = await applyProcessorConfig(
					processor,
					message.config,
					controlRevision,
					false,
				);
				const currentIntent = latestIntents.get(tabId);
				if (processors.get(tabId) !== processor
					|| (currentIntent && currentIntent[0] > generation)
					|| (currentIntent?.[1] === INTENT_STOP && currentIntent[0] === generation)
					|| processor.generation > generation
					|| processor.controlRevision > controlRevision) {
					return describeCurrentState(tabId, generation);
				}
				processor.generation = generation;
				processor.controlRevision = controlRevision;
				processor.snapshot = snapshot;
				recordControlRevision(tabId, controlRevision);
				latestIntents.set(tabId, [generation, INTENT_UPDATE, controlRevision]);
				return activeResult(processor);
			} catch (error) {
				return errorResult(
					tabId,
					processor.generation,
					processor.controlRevision,
					error,
					'capture_update_failed',
				);
			}
		}
		case 'OFFSCREEN_AUDIO_GET_VIZ_BATCH': {
			const frames: Record<string, number[] | null> = {};
			for (const tabId of message.tabIds) frames[String(tabId)] = getVisualizerFrame(tabId).buffer;
			return { frames };
		}
		case 'OFFSCREEN_AUDIO_SET_VIZ_SUBSCRIPTIONS':
			return setVisualizerSubscriptions(message.tabIds);
	}
}

export async function destroyAudioHost(): Promise<void> {
	await Promise.all([...processors.values()].map(disposeProcessor));
	latestIntents.clear();
	visualizerSubscriptions.clear();
}
