// goal: one shared, sparse and readback-capable DSP graph for admitted media or Capture sources

import {
	clampControlValue,
	type AudioProcessorConfig,
} from '@nexus/contracts';
import {
	BASS_FREQUENCY,
	BASS_GAIN,
	COMPRESSOR_ATTACK,
	COMPRESSOR_KNEE,
	COMPRESSOR_RATIO,
	COMPRESSOR_RELEASE,
	COMPRESSOR_THRESHOLD,
	EQ_FREQUENCIES,
	EQ_Q,
	FFT_SIZE,
} from './constants.js';

export type AudioGraphConfig = AudioProcessorConfig;

export interface AudioGraphSnapshot {
	phase: 'active';
	contextState: AudioContextState;
	graphSignature: string;
	normalizedActualConfig: AudioGraphConfig;
	outputChannels: number;
	sourceCount: number;
}

export interface AudioGraphApplyOptions {
	requireRunning?: boolean;
}

export interface AudioGraphRouterOptions {
	crossfadeMs?: number;
}

export const AUDIO_GRAPH_CROSSFADE_MS = 40;
export const AUDIO_PARAM_RAMP_MS = 15;

interface GraphLane {
	signature: string;
	fade: GainNode;
	nodes: AudioNode[];
	eqNodes: Map<number, BiquadFilterNode>;
	panner: StereoPannerNode | null;
	delay: DelayNode | null;
}

interface ApplyWaiter {
	resolve(snapshot: AudioGraphSnapshot): void;
	reject(error: unknown): void;
}

interface PendingApply {
	config: AudioGraphConfig;
	options: AudioGraphApplyOptions;
	waiters: ApplyWaiter[];
}

export const DEFAULT_AUDIO_GRAPH_CONFIG: Readonly<AudioGraphConfig> = {
	boostGain: 1,
	bass: false,
	eqValues: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
	compressor: false,
	mono: false,
	pan: 0,
	delay: 0,
};

export function normalizeAudioGraphConfig(config: AudioGraphConfig): AudioGraphConfig {
	return {
		boostGain: clampControlValue(config.boostGain, 'boost', 1),
		bass: config.bass === true,
		eqValues: EQ_FREQUENCIES.map((_, index) =>
			clampControlValue(config.eqValues[index] ?? 0, 'eqBand', 0)),
		compressor: config.compressor === true,
		mono: config.mono === true,
		pan: clampControlValue(config.pan, 'pan', 0),
		delay: clampControlValue(config.delay, 'delay', 0),
	};
}

function signatureForNormalizedConfig(config: AudioGraphConfig): string {
	const eq = config.eqValues
		.map((value, index) => value === 0 ? null : index)
		.filter((index): index is number => index !== null)
		.join(',');
	return [
		`bass:${config.bass ? 1 : 0}`,
		`eq:${eq || '-'}`,
		`compressor:${config.compressor ? 1 : 0}`,
		`mono:${config.mono ? 1 : 0}`,
		`pan:${config.pan === 0 ? 0 : 1}`,
		// Delay amount is a parameter, not topology. Rebuild only when the node
		// enters or leaves the sparse graph; continuous slider updates ramp the
		// existing DelayNode and therefore never allocate/crossfade a new lane.
		`delay:${config.delay === 0 ? 0 : 1}`,
	].join('|');
}

export function audioGraphSignature(config: AudioGraphConfig): string {
	return signatureForNormalizedConfig(normalizeAudioGraphConfig(config));
}

function setParam(
	param: AudioParam,
	value: number,
	time: number,
	durationMs = AUDIO_PARAM_RAMP_MS,
): void {
	param.cancelScheduledValues(time);
	if (durationMs === 0) param.setValueAtTime(value, time);
	else {
		param.setValueAtTime(param.value, time);
		param.linearRampToValueAtTime(value, time + durationMs / 1_000);
	}
}

function disconnect(node: AudioNode): void {
	node.disconnect();
}

export class AudioGraphRouter {
	private readonly input: GainNode;
	private readonly master: GainNode;
	private readonly output: GainNode;
	private readonly sources = new Set<AudioNode>();
	private readonly crossfadeMs: number;
	private activeLane: GraphLane | null = null;
	private analyser: AnalyserNode | null = null;
	private visualizerBuffer: Uint8Array<ArrayBuffer> | null = null;
	private analyserSubscribers = 0;
	private actualConfig: AudioGraphConfig | null = null;
	private pendingApply: PendingApply | null = null;
	private drainPromise: Promise<void> | null = null;
	private disposed = false;

	constructor(
		private readonly context: AudioContext,
		destination: AudioNode = context.destination,
		options: AudioGraphRouterOptions = {},
	) {
		const crossfadeMs = options.crossfadeMs ?? AUDIO_GRAPH_CROSSFADE_MS;
		this.crossfadeMs = Number.isFinite(crossfadeMs)
			? Math.max(0, Math.min(250, crossfadeMs))
			: AUDIO_GRAPH_CROSSFADE_MS;
		this.input = context.createGain();
		this.master = context.createGain();
		this.output = context.createGain();
		this.input.connect(this.master);
		this.output.connect(destination);
	}

	connectSource(source: AudioNode): boolean {
		this.assertUsable();
		if (this.sources.has(source)) return false;
		source.connect(this.input);
		this.sources.add(source);
		return true;
	}

	disconnectSource(source: AudioNode): boolean {
		if (!this.sources.delete(source)) return false;
		try { source.disconnect(this.input); } catch { disconnect(source); }
		return true;
	}

	apply(
		config: AudioGraphConfig,
		options: AudioGraphApplyOptions = {},
	): Promise<AudioGraphSnapshot> {
		this.assertUsable();
		return new Promise((resolve, reject) => {
			const waiter = { resolve, reject };
			const normalized = normalizeAudioGraphConfig(config);
			if (this.pendingApply) {
				// Continuous controls admit one active apply plus one latest candidate.
				// Superseded callers resolve with the candidate that actually committed,
				// so no stale Delay lane or intermediate EQ graph is built later.
				this.pendingApply.config = normalized;
				this.pendingApply.options = { ...options };
				this.pendingApply.waiters.push(waiter);
			} else {
				this.pendingApply = {
					config: normalized,
					options: { ...options },
					waiters: [waiter],
				};
			}
			this.startDrain();
		});
	}

	private startDrain(): void {
		if (this.drainPromise) return;
		const operation = (async () => {
			while (this.pendingApply) {
				const pending = this.pendingApply;
				this.pendingApply = null;
				try {
					const snapshot = await this.applyNow(pending.config, pending.options);
					for (const waiter of pending.waiters) waiter.resolve(snapshot);
				} catch (error) {
					for (const waiter of pending.waiters) waiter.reject(error);
				}
			}
		})().finally(() => {
			if (this.drainPromise === operation) this.drainPromise = null;
			if (this.pendingApply) this.startDrain();
		});
		this.drainPromise = operation;
	}

	bypass(options: AudioGraphApplyOptions = {}): Promise<AudioGraphSnapshot> {
		return this.apply(DEFAULT_AUDIO_GRAPH_CONFIG, options);
	}

	subscribeVisualizer(): () => void {
		this.assertUsable();
		this.analyserSubscribers += 1;
		if (!this.analyser) {
			this.analyser = this.context.createAnalyser();
			this.analyser.fftSize = FFT_SIZE;
			this.output.connect(this.analyser);
		}
		let subscribed = true;
		return () => {
			if (!subscribed) return;
			subscribed = false;
			this.analyserSubscribers = Math.max(0, this.analyserSubscribers - 1);
			if (this.analyserSubscribers === 0 && this.analyser) {
				disconnect(this.analyser);
				this.output.disconnect(this.analyser);
				this.analyser = null;
				this.visualizerBuffer = null;
			}
		};
	}

	getVisualizerData(): Uint8Array | null {
		if (!this.analyser) return null;
		if (!this.visualizerBuffer || this.visualizerBuffer.length !== this.analyser.frequencyBinCount) {
			this.visualizerBuffer = new Uint8Array(this.analyser.frequencyBinCount);
		}
		this.analyser.getByteFrequencyData(this.visualizerBuffer);
		return this.visualizerBuffer;
	}

	getSnapshot(): AudioGraphSnapshot | null {
		if (!this.activeLane || !this.actualConfig) return null;
		return this.snapshot(this.activeLane.signature, this.actualConfig);
	}

	async dispose(disconnectSources = true): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		await this.drainPromise;
		if (disconnectSources) {
			for (const source of this.sources) disconnect(source);
		}
		this.sources.clear();
		if (this.activeLane) this.destroyLane(this.activeLane);
		if (this.analyser) disconnect(this.analyser);
		disconnect(this.input);
		disconnect(this.master);
		disconnect(this.output);
		this.activeLane = null;
		this.actualConfig = null;
		this.analyser = null;
		this.visualizerBuffer = null;
		this.analyserSubscribers = 0;
	}

	private async applyNow(
		config: AudioGraphConfig,
		options: AudioGraphApplyOptions,
	): Promise<AudioGraphSnapshot> {
		this.assertUsable();
		if (options.requireRunning && this.context.state !== 'running') {
			throw new Error(`AudioContext is ${this.context.state}, expected running`);
		}
		// `apply()` canonicalizes before enqueueing; using that normalized value
		// here avoids a second allocation and clamp pass on every acknowledged
		// update while preserving the same transaction boundary.
		const normalized = config;
		const signature = signatureForNormalizedConfig(normalized);
		const time = this.context.currentTime;

		if (this.activeLane?.signature === signature) {
			setParam(
				this.master.gain,
				normalized.boostGain,
				time,
				AUDIO_PARAM_RAMP_MS,
			);
			this.updateLane(this.activeLane, normalized);
			// A parameter-only apply (boost, EQ gain, pan, delay) is acknowledged as
			// soon as the ramps are scheduled. The AudioParam automation starts
			// moving immediately; awaiting the ramp here would add a fixed
			// `AUDIO_PARAM_RAMP_MS` of artificial latency to every volume crossing
			// while adding no readback fidelity (the ACK snapshot is nominal). The
			// next apply cancels the pending ramp and re-ramps from the live value,
			// so rapid slider updates still converge on their final targets.
			this.actualConfig = normalized;
			return this.snapshot(signature, normalized);
		}

		const candidate = this.buildLane(normalized, signature);
		// Build the candidate before mutating the live master gain. A node
		// construction failure must leave the previously acknowledged lane and
		// output gain untouched for transaction rollback.
		setParam(
			this.master.gain,
			normalized.boostGain,
			time,
			AUDIO_PARAM_RAMP_MS,
		);
		// A newly connected GainNode defaults to 1. Set its gate before it can
		// reach the live output, otherwise one render quantum can carry both the
		// old and candidate lanes at full gain.
		setParam(candidate.fade.gain, this.activeLane ? 0 : 1, time, 0);
		this.master.connect(candidate.fade);
		if (!this.activeLane) {
			await new Promise<void>((resolve) => setTimeout(resolve, AUDIO_PARAM_RAMP_MS));
			this.activeLane = candidate;
			this.actualConfig = normalized;
			return this.snapshot(signature, normalized);
		}

		const previous = this.activeLane;
		setParam(previous.fade.gain, 1, time, 0);
		if (this.crossfadeMs === 0) {
			setParam(candidate.fade.gain, 1, time, 0);
			setParam(previous.fade.gain, 0, time, 0);
		} else {
			const end = time + this.crossfadeMs / 1_000;
			candidate.fade.gain.linearRampToValueAtTime(1, end);
			previous.fade.gain.linearRampToValueAtTime(0, end);
			await new Promise<void>((resolve) => setTimeout(resolve, this.crossfadeMs));
		}
		this.destroyLane(previous);
		this.activeLane = candidate;
		this.actualConfig = normalized;
		return this.snapshot(signature, normalized);
	}

	private buildLane(config: AudioGraphConfig, signature: string): GraphLane {
		const nodes: AudioNode[] = [];
		const eqNodes = new Map<number, BiquadFilterNode>();
		const fade = this.context.createGain();
		nodes.push(fade);
		let head: AudioNode = fade;
		let panner: StereoPannerNode | null = null;
		let delay: DelayNode | null = null;

		const append = <T extends AudioNode>(node: T): T => {
			head.connect(node);
			nodes.push(node);
			head = node;
			return node;
		};

		try {
			if (config.bass) {
				const bass = append(this.context.createBiquadFilter());
				bass.type = 'lowshelf';
				bass.frequency.value = BASS_FREQUENCY;
				bass.gain.value = BASS_GAIN;
			}
			for (const [index, value] of config.eqValues.entries()) {
				if (value === 0) continue;
				const node = append(this.context.createBiquadFilter());
				node.type = 'peaking';
				node.frequency.value = EQ_FREQUENCIES[index] ?? 1_000;
				node.Q.value = EQ_Q;
				node.gain.value = value;
				eqNodes.set(index, node);
			}
			if (config.compressor) {
				const compressor = append(this.context.createDynamicsCompressor());
				compressor.threshold.value = COMPRESSOR_THRESHOLD;
				compressor.knee.value = COMPRESSOR_KNEE;
				compressor.ratio.value = COMPRESSOR_RATIO;
				compressor.attack.value = COMPRESSOR_ATTACK;
				compressor.release.value = COMPRESSOR_RELEASE;
			}
			if (config.mono) head = this.appendDeterministicMono(head, nodes);
			if (config.pan !== 0) {
				panner = append(this.context.createStereoPanner());
				panner.pan.value = config.pan;
			}
			if (config.delay !== 0) {
				delay = append(this.context.createDelay(0.5));
				delay.delayTime.value = config.delay / 1_000;
			}
			head.connect(this.output);
			return { signature, fade, nodes, eqNodes, panner, delay };
		} catch (error) {
			for (const node of nodes) disconnect(node);
			throw error;
		}
	}

	private appendDeterministicMono(head: AudioNode, nodes: AudioNode[]): AudioNode {
		const splitter = this.context.createChannelSplitter(2);
		const left = this.context.createGain();
		const right = this.context.createGain();
		const sum = this.context.createGain();
		const merger = this.context.createChannelMerger(2);
		left.gain.value = 0.5;
		right.gain.value = 0.5;
		head.connect(splitter);
		splitter.connect(left, 0);
		splitter.connect(right, 1);
		left.connect(sum);
		right.connect(sum);
		sum.connect(merger, 0, 0);
		sum.connect(merger, 0, 1);
		nodes.push(splitter, left, right, sum, merger);
		return merger;
	}

	private updateLane(lane: GraphLane, config: AudioGraphConfig): void {
		const time = this.context.currentTime;
		for (const [index, node] of lane.eqNodes) {
			setParam(node.gain, config.eqValues[index] ?? 0, time);
		}
		if (lane.panner) setParam(lane.panner.pan, config.pan, time);
		if (lane.delay) setParam(lane.delay.delayTime, config.delay / 1_000, time);
	}

	private destroyLane(lane: GraphLane): void {
		this.master.disconnect(lane.fade);
		for (const node of lane.nodes) disconnect(node);
	}

	private snapshot(signature: string, config: AudioGraphConfig): AudioGraphSnapshot {
		return {
			phase: 'active',
			contextState: this.context.state,
			graphSignature: signature,
			normalizedActualConfig: { ...config, eqValues: [...config.eqValues] },
			outputChannels: config.mono || config.pan !== 0 ? 2 : Math.max(1, this.context.destination.channelCount || 2),
			sourceCount: this.sources.size,
		};
	}

	private assertUsable(): void {
		if (this.disposed) throw new Error('Audio graph router is disposed');
	}
}
