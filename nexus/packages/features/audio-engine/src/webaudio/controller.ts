// goal: main controller for managing the WebAudio graph and media element attachments
// note: world-class performance: uses centralized detachment and a factory for lean management

import { AudioParams, CompressorOn } from '../constants.js';
import { scheduleCorsCheck } from './cors-checker.js';
import { createAudioGraph, setCompressorEnabled } from './node-factory.js';
import type { AudioConfig, AudioNodeSet, AudioMediaElement, CorsDetectedCallback, CorsSuccessCallback } from './types.js';

export type { AudioConfig, CorsDetectedCallback, CorsSuccessCallback };

export class WebAudioController {
	private ctx: AudioContext | null = null;
	private onCorsDetected: CorsDetectedCallback | null = null;
	private onCorsSuccess: CorsSuccessCallback | null = null;
	private skipCorsCheck = false;
	private attachedNodes = new WeakMap<HTMLMediaElement, AudioNodeSet>();

	private adoptExistingGraphs(): void {
		document.querySelectorAll<HTMLMediaElement>('video, audio').forEach((element) => {
			const media = element as AudioMediaElement;
			if (!media._vm) return;
			const vm = media._vm as AudioNodeSet & { chainTail?: AudioNode; compressorEnabled?: boolean };
			if (!vm.chainTail) {
				vm.chainTail = vm.eqNodes[vm.eqNodes.length - 1] ?? vm.bass;
				// Older builds permanently routed through the limiter. Normalize it to bypass.
				try { vm.chainTail.disconnect(); } catch { /* ignore */ }
				try { vm.comp.disconnect(); } catch { /* ignore */ }
				vm.chainTail.connect(vm.panner);
				vm.compressorEnabled = false;
			}
			this.attachedNodes.set(element, vm as AudioNodeSet);
			const graphContext = vm.source.context;
			if (!this.ctx && graphContext instanceof AudioContext && graphContext.state !== 'closed') {
				this.ctx = graphContext;
			}
		});
	}

	async initialize(attemptResume = false): Promise<boolean> {
		this.adoptExistingGraphs();
		if (this.ctx && this.ctx.state !== 'closed') {
			if (this.ctx.state === 'suspended' && attemptResume) {
				try { await this.ctx.resume(); } catch { return false; }
			}
			return this.ctx.state === 'running';
		}
		try {
			const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
			this.ctx = new AC();
			if (attemptResume && this.ctx.state === 'suspended') {
				try { await this.ctx.resume(); } catch { return false; }
			}
			return this.ctx.state === 'running';
		} catch { return false; }
	}

	cleanup(): void {
		this.adoptExistingGraphs();
		if (!this.ctx) return;
		const t = this.ctx.currentTime, r = AudioParams.SMOOTH_TIME_FAST;
		document.querySelectorAll('video, audio').forEach((el) => {
			const m = el as AudioMediaElement;
			if (!m._vm) return;
			const { gain, bass, eqNodes, panner, delayNode } = m._vm;
			gain.gain.setTargetAtTime(1, t, r);
			gain.channelCount = 2;
			gain.channelCountMode = 'max';
			bass.gain.setTargetAtTime(0, t, r);
			setCompressorEnabled(m._vm, false);
			eqNodes.forEach((n) => n.gain.setTargetAtTime(0, t, r));
			panner.pan.setTargetAtTime(0, t, r);
			delayNode.delayTime.setTargetAtTime(0, t, r);
		});
	}

	isReady(): boolean { return this.ctx !== null && this.ctx.state !== 'closed'; }

	// post: reset to transparent bypass without closing the context or invalidating source bindings
	async destroyContext(): Promise<void> {
		this.cleanup();
	}

	setCallbacks(onDetected: CorsDetectedCallback, onSuccess: CorsSuccessCallback): void {
		this.onCorsDetected = onDetected;
		this.onCorsSuccess = onSuccess;
	}

	setSkipCorsCheck(skip: boolean): void {
		this.skipCorsCheck = skip;
	}

	scanAndAttach(): number {
		if (!this.ctx) return 0;
		let attached = 0;
		document.querySelectorAll('video, audio').forEach((el) => {
			if (this.attachNode(el as HTMLMediaElement)) attached++;
		});
		return attached;
	}

	attachNode(el: HTMLMediaElement): boolean {
		const m = el as AudioMediaElement;
		if (this.attachedNodes.has(el)
			|| m._vm
			|| m.dataset.vmAttached === 'true'
			|| m.dataset.vmProbed === 'true'
			|| !this.ctx) return false;

		try {
			if (!el.crossOrigin && el.src && !el.src.startsWith('data:') && !el.src.startsWith('blob:')) {
				el.crossOrigin = 'anonymous';
			}

			m._vm = createAudioGraph(this.ctx, el);
			m.dataset.vmAttached = 'true';
			this.attachedNodes.set(el, m._vm);

			const resume = () => {
				if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => { });
			};
			el.addEventListener('play', resume);

			if (!this.skipCorsCheck) {
				scheduleCorsCheck(m._vm.analyser, el, (restricted) => {
					if (restricted) this.handleCorsDetected();
					else this.handleCorsSuccess();
				});
			}
			return true;
		} catch {
			m.dataset.vmProbed = 'true';
			this.handleCorsDetected();
			return false;
		}
	}

	detachNode(el: HTMLMediaElement): void {
		const vm = this.attachedNodes.get(el);
		if (!vm) return;
		// MediaElementSource bindings are permanent. Keep the graph and make it transparent.
		const t = vm.source.context.currentTime;
		vm.gain.gain.setTargetAtTime(1, t, AudioParams.SMOOTH_TIME_FAST);
		vm.bass.gain.setTargetAtTime(0, t, AudioParams.SMOOTH_TIME_FAST);
		vm.eqNodes.forEach((node) => node.gain.setTargetAtTime(0, t, AudioParams.SMOOTH_TIME_FAST));
		vm.panner.pan.setTargetAtTime(0, t, AudioParams.SMOOTH_TIME_FAST);
		vm.delayNode.delayTime.setTargetAtTime(0, t, AudioParams.SMOOTH_TIME_FAST);
		setCompressorEnabled(vm, false);
	}

	private applyParamsToNode(vm: AudioNodeSet, config: AudioConfig): void {
		const t = vm.source.context.currentTime;
		const r = AudioParams.SMOOTH_TIME_FAST;
		const v = config.muted ? 0 : config.volume / 100;
		const { gain, bass, comp, eqNodes, panner, delayNode } = vm;

		gain.gain.setTargetAtTime(v, t, r);
		gain.channelCount = config.mono ? 1 : 2;
		gain.channelCountMode = config.mono ? 'explicit' : 'max';
		bass.gain.setTargetAtTime(config.bass ? AudioParams.BASS_GAIN : 0, t, r);

		setCompressorEnabled(vm, config.compressor);
		if (config.compressor) {
			comp.threshold.setTargetAtTime(CompressorOn.threshold, t, r);
			comp.knee.setTargetAtTime(CompressorOn.knee, t, r);
			comp.ratio.setTargetAtTime(CompressorOn.ratio, t, r);
			comp.attack.setTargetAtTime(CompressorOn.attack, t, r);
			comp.release.setTargetAtTime(CompressorOn.release, t, r);
		}

		eqNodes.forEach((node, index) => node.gain.setTargetAtTime(config.eqValues[index] ?? 0, t, r));
		panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, config.pan ?? 0)), t, r);
		delayNode.delayTime.setTargetAtTime(Math.max(0, Math.min(500, config.delay ?? 0)) / 1000, t, r);
	}

	updateElementParams(el: HTMLMediaElement, config: AudioConfig): boolean {
		const media = el as AudioMediaElement;
		const vm = this.attachedNodes.get(el) ?? media._vm;
		if (!vm) return false;
		this.attachedNodes.set(el, vm);
		this.applyParamsToNode(vm, config);
		return true;
	}

	updateParams(config: AudioConfig): void {
		this.adoptExistingGraphs();
		document.querySelectorAll('video, audio').forEach((el) => {
			const m = el as AudioMediaElement;
			if (!m._vm) return;
			this.applyParamsToNode(m._vm, config);
		});
	}

	getVisualizerData(): Uint8Array | null {
		this.adoptExistingGraphs();
		if (!this.ctx) return null;
		for (const el of document.querySelectorAll('video, audio')) {
			const m = el as AudioMediaElement;
			if (m._vm?.analyser) {
				const data = new Uint8Array(m._vm.analyser.frequencyBinCount);
				m._vm.analyser.getByteFrequencyData(data);
				return data;
			}
		}
		return null;
	}

	private handleCorsSuccess(): void { this.onCorsSuccess?.(window.location.hostname); }
	private handleCorsDetected(): void { this.onCorsDetected?.(window.location.hostname); }
}
