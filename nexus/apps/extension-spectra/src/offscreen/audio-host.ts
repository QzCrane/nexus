// goal: acknowledged, generation-aware tab-capture audio processing for the unified offscreen host

import { AudioParams, CompressorOn } from '@nexus/audio-engine';
import {
	type AudioConfig,
	type OffscreenAudioEvent,
	type OffscreenAudioRequest,
	type OffscreenAudioRequestType,
	type OffscreenAudioResult,
	type OffscreenHostResponse,
} from '@nexus/contracts';

export interface AudioHostDescription {
	tabId: number;
	generation: number;
}

interface AudioProcessor {
	tabId: number;
	generation: number;
	ctx: AudioContext;
	stream: MediaStream;
	source: MediaStreamAudioSourceNode;
	gain: GainNode;
	bass: BiquadFilterNode;
	comp: DynamicsCompressorNode;
	eqNodes: BiquadFilterNode[];
	panner: StereoPannerNode;
	delayNode: DelayNode;
	analyser: AnalyserNode;
	chainTail: AudioNode;
	compressorEnabled: boolean;
	vizBuffer: Uint8Array<ArrayBuffer>;
	lastVizAt: number;
	lastVizFrame: number[] | null;
	trackEndedDisposers: Array<() => void>;
	disposing: boolean;
}

type AudioIntentKind = 'start' | 'update' | 'stop';

interface AudioIntent {
	generation: number;
	kind: AudioIntentKind;
}

export type AudioHostResult = OffscreenAudioResult;

const processors = new Map<number, AudioProcessor>();
// A processor is committed only while its START remains the latest intent for
// the tab. STOP/UPDATE intents are retained even when no processor exists so a
// delayed getUserMedia()/resume() cannot resurrect an older capture graph.
const latestIntents = new Map<number, AudioIntent>();

function recordIntent(tabId: number, generation: number, kind: AudioIntentKind): AudioIntent {
	const current = latestIntents.get(tabId);
	if (!current || generation > current.generation) {
		const next = { generation, kind };
		latestIntents.set(tabId, next);
		return next;
	}
	if (generation === current.generation && kind === 'stop' && current.kind !== 'stop') {
		const next = { generation, kind };
		latestIntents.set(tabId, next);
		return next;
	}
	return current;
}

function isCurrentStartIntent(tabId: number, generation: number): boolean {
	const intent = latestIntents.get(tabId);
	return intent?.generation === generation && intent.kind === 'start';
}

function describeCurrentState(tabId: number, fallbackGeneration: number): AudioHostResult {
	const processor = processors.get(tabId);
	if (processor) {
		return { ok: true, tabId, generation: processor.generation, phase: 'active' };
	}
	const generation = Math.max(fallbackGeneration, latestIntents.get(tabId)?.generation ?? 0);
	return { ok: true, tabId, generation, phase: 'idle' };
}

function errorResult(tabId: number, generation: number, error: unknown): AudioHostResult {
	const message = error instanceof Error ? error.message : String(error);
	return {
		ok: false,
		tabId,
		generation,
		error: { code: 'capture_start_failed', message, retryable: true },
	};
}

function staleIntentResult(tabId: number, generation: number): AudioHostResult {
	return {
		ok: false,
		tabId,
		generation,
		error: {
			code: 'stale_capture_intent',
			message: 'Capture configuration belongs to a stopped generation',
			retryable: true,
		},
	};
}

function setCompressorPath(processor: AudioProcessor, enabled: boolean): void {
	if (processor.compressorEnabled === enabled) return;
	processor.chainTail.disconnect();
	processor.comp.disconnect();
	if (enabled) {
		processor.chainTail.connect(processor.comp);
		processor.comp.connect(processor.panner);
	} else {
		processor.chainTail.connect(processor.panner);
	}
	processor.compressorEnabled = enabled;
}

function applyConfig(processor: AudioProcessor, config: AudioConfig): void {
	const t = processor.ctx.currentTime;
	const ramp = AudioParams.SMOOTH_TIME;
	const volume = Number.isFinite(config.volume) ? Math.max(0, Math.min(800, config.volume)) : 100;
	processor.gain.gain.setTargetAtTime(config.muted ? 0 : volume / 100, t, ramp);
	processor.gain.channelCount = config.mono ? 1 : 2;
	processor.gain.channelCountMode = config.mono ? 'explicit' : 'max';
	processor.bass.gain.setTargetAtTime(config.bass ? AudioParams.BASS_GAIN : 0, t, ramp);

	for (let i = 0; i < processor.eqNodes.length; i++) {
		const value = Math.max(-12, Math.min(12, config.eqValues?.[i] ?? 0));
		processor.eqNodes[i]!.gain.setTargetAtTime(value, t, ramp);
	}

	setCompressorPath(processor, config.compressor);
	if (config.compressor) {
		processor.comp.threshold.setTargetAtTime(CompressorOn.threshold, t, ramp);
		processor.comp.knee.setTargetAtTime(CompressorOn.knee, t, ramp);
		processor.comp.ratio.setTargetAtTime(CompressorOn.ratio, t, ramp);
		processor.comp.attack.setTargetAtTime(CompressorOn.attack, t, ramp);
		processor.comp.release.setTargetAtTime(CompressorOn.release, t, ramp);
	}

	processor.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, config.pan ?? 0)), t, ramp);
	const delayMs = Math.max(0, Math.min(500, config.delay ?? 0));
	processor.delayNode.delayTime.setTargetAtTime(delayMs / 1000, t, ramp);
}

async function disposeProcessor(processor: AudioProcessor): Promise<void> {
	if (processor.disposing) return;
	processor.disposing = true;
	if (processors.get(processor.tabId) === processor) processors.delete(processor.tabId);
	for (const dispose of processor.trackEndedDisposers) dispose();
	processor.trackEndedDisposers.length = 0;
	for (const track of processor.stream.getTracks()) track.stop();
	try { processor.source.disconnect(); } catch { /* already disconnected */ }
	try { processor.gain.disconnect(); } catch { /* already disconnected */ }
	try { processor.bass.disconnect(); } catch { /* already disconnected */ }
	for (const node of processor.eqNodes) {
		try { node.disconnect(); } catch { /* already disconnected */ }
	}
	try { processor.comp.disconnect(); } catch { /* already disconnected */ }
	try { processor.panner.disconnect(); } catch { /* already disconnected */ }
	try { processor.delayNode.disconnect(); } catch { /* already disconnected */ }
	try { processor.analyser.disconnect(); } catch { /* already disconnected */ }
	try { await processor.ctx.close(); } catch { /* document teardown may have closed it */ }
}

function notifyProcessorEnded(processor: AudioProcessor): void {
	const runtime = typeof chrome === 'undefined' ? undefined : chrome.runtime;
	if (!runtime?.sendMessage) return;
	const event: OffscreenAudioEvent = {
		type: 'OFFSCREEN_AUDIO_ENDED',
		tabId: processor.tabId,
		generation: processor.generation,
	};
	void runtime.sendMessage(event).catch(() => undefined);
}

function observeTrackEnd(processor: AudioProcessor): void {
	for (const track of processor.stream.getTracks()) {
		if (typeof track.addEventListener !== 'function') continue;
		const handleEnded = () => {
			if (processor.disposing) return;
			const wasCurrent = processors.get(processor.tabId) === processor;
			recordIntent(processor.tabId, processor.generation, 'stop');
			void disposeProcessor(processor).finally(() => {
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
	config: AudioConfig,
	generation: number,
): Promise<AudioHostResult> {
	const intent = recordIntent(tabId, generation, 'start');
	if (intent.generation !== generation || intent.kind !== 'start') {
		return describeCurrentState(tabId, generation);
	}
	const existing = processors.get(tabId);
	if (existing) {
		if (existing.generation > generation) {
			return { ok: true, tabId, generation: existing.generation, phase: 'active' };
		}
		if (existing.generation === generation) {
			applyConfig(existing, config);
			return { ok: true, tabId, generation, phase: 'active' };
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
		ctx = new AudioContext();
		const source = ctx.createMediaStreamSource(stream);
		const gain = ctx.createGain();
		const bass = ctx.createBiquadFilter();
		bass.type = 'lowshelf';
		bass.frequency.value = AudioParams.BASS_FREQUENCY;

		const eqNodes = AudioParams.EQ_FREQUENCIES.map((frequency) => {
			const node = ctx!.createBiquadFilter();
			node.type = 'peaking';
			node.frequency.value = frequency;
			node.Q.value = AudioParams.EQ_Q;
			return node;
		});
		const comp = ctx.createDynamicsCompressor();
		const panner = ctx.createStereoPanner();
		const delayNode = ctx.createDelay(0.5);
		const analyser = ctx.createAnalyser();
		analyser.fftSize = AudioParams.FFT_SIZE;
		const vizBuffer = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;

		let chainTail: AudioNode = source;
		chainTail.connect(gain); chainTail = gain;
		chainTail.connect(bass); chainTail = bass;
		for (const node of eqNodes) { chainTail.connect(node); chainTail = node; }
		// Compressor starts physically bypassed. It is connected only when explicitly enabled.
		chainTail.connect(panner);
		panner.connect(delayNode);
		delayNode.connect(analyser);

		candidate = {
			tabId,
			generation,
			ctx,
			stream,
			source,
			gain,
			bass,
			comp,
			eqNodes,
			panner,
			delayNode,
			analyser,
			chainTail,
			compressorEnabled: false,
			vizBuffer,
			lastVizAt: 0,
			lastVizFrame: null,
			trackEndedDisposers: [],
			disposing: false,
		};
		observeTrackEnd(candidate);
		applyConfig(candidate, config);
		if (ctx.state === 'suspended') await ctx.resume();
		if (!isCurrentStartIntent(tabId, generation)) {
			await disposeProcessor(candidate);
			return describeCurrentState(tabId, generation);
		}

		// Commit only after the replacement graph is fully constructed and runnable.
		// The previous acknowledged processor keeps producing audio if setup fails.
		const current = processors.get(tabId);
		if (current?.generation === generation) {
			applyConfig(current, config);
			await disposeProcessor(candidate);
			return { ok: true, tabId, generation, phase: 'active' };
		}
		if (current && current.generation > generation) {
			await disposeProcessor(candidate);
			return { ok: true, tabId, generation: current.generation, phase: 'active' };
		}
		const previousDisposal = current ? disposeProcessor(current) : Promise.resolve();
		processors.set(tabId, candidate);
		candidate.analyser.connect(ctx.destination);
		await previousDisposal;
		return { ok: true, tabId, generation, phase: 'active' };
	} catch (error) {
		if (candidate) await disposeProcessor(candidate);
		else {
			if (stream) for (const track of stream.getTracks()) track.stop();
			if (ctx) try { await ctx.close(); } catch { /* ignore */ }
		}
		return errorResult(tabId, generation, error);
	}
}

async function stopCapture(tabId: number, generation: number): Promise<AudioHostResult> {
	const intent = recordIntent(tabId, generation, 'stop');
	const processor = processors.get(tabId);
	if (!processor) return describeCurrentState(tabId, intent.generation);
	if (processor.generation > generation) {
		return { ok: true, tabId, generation: processor.generation, phase: 'active' };
	}
	await disposeProcessor(processor);
	return { ok: true, tabId, generation, phase: 'idle' };
}

async function cancelPendingStart(
	tabId: number,
	generation: number,
	stopCommitted: boolean,
): Promise<AudioHostResult> {
	recordIntent(tabId, generation, 'stop');
	const processor = processors.get(tabId);
	if (stopCommitted && processor?.generation === generation) {
		await disposeProcessor(processor);
	}
	return describeCurrentState(tabId, generation);
}

function getVisualizerFrame(tabId: number): { buffer: number[] | null } {
	const processor = processors.get(tabId);
	if (!processor) return { buffer: null };
	const now = performance.now();
	if (!processor.lastVizFrame || now - processor.lastVizAt >= 1000 / 15) {
		processor.analyser.getByteFrequencyData(processor.vizBuffer);
		processor.lastVizFrame = Array.from(processor.vizBuffer);
		processor.lastVizAt = now;
	}
	return { buffer: processor.lastVizFrame };
}

export function describeAudioHost(): AudioHostDescription[] {
	return [...processors.values()].map(({ tabId, generation }) => ({ tabId, generation }));
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
			);
		case 'OFFSCREEN_AUDIO_STOP':
			return stopCapture(message.tabId, message.generation);
		case 'OFFSCREEN_AUDIO_CANCEL_START':
			return cancelPendingStart(
				message.tabId,
				message.generation,
				message.stopCommitted,
			);
		case 'OFFSCREEN_AUDIO_UPDATE':
		{
			const { tabId, generation: requestedGeneration } = message;
			const previousIntent = latestIntents.get(tabId);
			if (previousIntent?.kind === 'stop'
				&& requestedGeneration <= previousIntent.generation) {
				return staleIntentResult(tabId, previousIntent.generation);
			}
			if (!previousIntent || requestedGeneration > previousIntent.generation) {
				recordIntent(tabId, requestedGeneration, 'update');
			}
			const processor = processors.get(tabId);
			if (!processor) return errorResult(tabId, requestedGeneration, 'Capture is not active');
			const { generation } = message;
			if (generation < processor.generation) {
				return { ok: true, tabId: processor.tabId, generation: processor.generation, phase: 'active' };
			}
			processor.generation = generation;
			applyConfig(processor, message.config);
			return { ok: true, tabId: processor.tabId, generation: processor.generation, phase: 'active' };
		}
		case 'OFFSCREEN_AUDIO_GET_VIZ':
			return getVisualizerFrame(message.tabId);
		case 'OFFSCREEN_AUDIO_GET_VIZ_BATCH': {
			const frames: Record<string, number[] | null> = {};
			for (const tabId of message.tabIds) frames[String(tabId)] = getVisualizerFrame(tabId).buffer;
			return { frames };
		}
	}
}

export async function destroyAudioHost(): Promise<void> {
	await Promise.all([...processors.values()].map(disposeProcessor));
	latestIntents.clear();
}
