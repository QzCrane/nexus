/**
 * NEXUS Audio Engine - WebAudio 控制器
 */

import { AudioParams, CompressorOn, CompressorNativeOff } from '../constants.js';
import type {
	AudioConfig, AudioNodeSet, AudioMediaElement,
	CorsDetectedCallback, CorsSuccessCallback
} from './types.js';

export type { AudioConfig, CorsDetectedCallback, CorsSuccessCallback };

/** WebAudio 控制器类 */
export class WebAudioController {
	private ctx: AudioContext | null = null;
	private onCorsDetected: CorsDetectedCallback | null = null;
	private onCorsSuccess: CorsSuccessCallback | null = null;

	/** 初始化 AudioContext */
	async initialize(): Promise<boolean> {
		if (this.ctx && this.ctx.state !== 'closed') {
			if (this.ctx.state === 'suspended') {
				try { await this.ctx.resume(); } catch { return false; }
			}
			return this.ctx.state === 'running';
		}
		try {
			const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
			this.ctx = new AC();
			if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => { });
			return this.ctx.state === 'running';
		} catch { return false; }
	}

	/** 进入旁通模式 */
	cleanup(): void {
		if (!this.ctx) return;
		const t = this.ctx.currentTime, r = AudioParams.SMOOTH_TIME_FAST;
		document.querySelectorAll('video, audio').forEach((el) => {
			const mediaEl = el as AudioMediaElement;
			if (!mediaEl._vm) return;
			const { gain, bass, comp, eqNodes } = mediaEl._vm;
			gain.gain.setTargetAtTime(1, t, r);
			gain.channelCount = 2;
			bass.gain.setTargetAtTime(0, t, r);
			comp.threshold.setTargetAtTime(CompressorNativeOff.threshold, t, r);
			comp.ratio.setTargetAtTime(CompressorNativeOff.ratio, t, r);
			eqNodes.forEach((n) => n.gain.setTargetAtTime(0, t, r));
		});
	}

	isReady(): boolean { return this.ctx !== null && this.ctx.state !== 'closed'; }

	setCallbacks(onDetected: CorsDetectedCallback, onSuccess: CorsSuccessCallback): void {
		this.onCorsDetected = onDetected;
		this.onCorsSuccess = onSuccess;
	}

	/** 扫描并附加媒体元素 */
	scanAndAttach(): number {
		if (!this.ctx) return 0;
		let attached = 0;
		document.querySelectorAll('video, audio').forEach((el) => {
			if (this.attachNode(el as HTMLMediaElement)) attached++;
		});
		return attached;
	}

	/** 附加音频处理节点 */
	attachNode(el: HTMLMediaElement): boolean {
		const mediaEl = el as AudioMediaElement;
		if (mediaEl._vm || mediaEl.dataset.vmAttached === 'true' || !this.ctx) return false;

		try {
			if (!el.crossOrigin && el.src && !el.src.startsWith('data:') && !el.src.startsWith('blob:')) {
				el.crossOrigin = 'anonymous';
			}
			const source = this.ctx.createMediaElementSource(el);
			this.handleCorsSuccess();

			const gain = this.ctx.createGain();
			const bass = this.ctx.createBiquadFilter();
			bass.type = 'lowshelf';
			bass.frequency.value = AudioParams.BASS_FREQUENCY;

			const comp = this.ctx.createDynamicsCompressor();
			const analyser = this.ctx.createAnalyser();
			analyser.fftSize = AudioParams.FFT_SIZE;

			const eqNodes = AudioParams.EQ_FREQUENCIES.map((freq) => {
				const node = this.ctx!.createBiquadFilter();
				node.type = 'peaking';
				node.frequency.value = freq;
				node.Q.value = AudioParams.EQ_Q;
				return node;
			});

			// 连接: Source -> Gain -> Bass -> EQ -> Comp -> Analyser -> Dest
			let head: AudioNode = source;
			head.connect(gain); head = gain;
			head.connect(bass); head = bass;
			eqNodes.forEach((n) => { head.connect(n); head = n; });
			head.connect(comp); head = comp;
			head.connect(analyser);
			analyser.connect(this.ctx.destination);

			mediaEl._vm = { source, gain, bass, comp, eqNodes, analyser };
			mediaEl.dataset.vmAttached = 'true';

			el.addEventListener('play', () => {
				if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => { });
			});

			return true;
		} catch {
			this.handleCorsDetected();
			return false;
		}
	}

	/** 更新音频参数 */
	updateParams(config: AudioConfig): void {
		if (!this.ctx) return;
		const t = this.ctx.currentTime, r = AudioParams.SMOOTH_TIME_FAST;
		const v = config.muted ? 0 : config.volume / 100;

		document.querySelectorAll('video, audio').forEach((el) => {
			const mediaEl = el as AudioMediaElement;
			if (!mediaEl._vm) return;
			const { gain, bass, comp, eqNodes } = mediaEl._vm;

			gain.gain.setTargetAtTime(v, t, r);
			gain.channelCount = config.mono ? 1 : 2;
			bass.gain.setTargetAtTime(config.bass ? AudioParams.BASS_GAIN : 0, t, r);

			if (config.compressor) {
				comp.threshold.setTargetAtTime(CompressorOn.threshold, t, r);
				comp.ratio.setTargetAtTime(CompressorOn.ratio, t, r);
			} else {
				comp.threshold.setTargetAtTime(CompressorNativeOff.threshold, t, r);
				comp.ratio.setTargetAtTime(CompressorNativeOff.ratio, t, r);
			}

			eqNodes.forEach((n, i) => n.gain.setTargetAtTime(config.eqValues[i] ?? 0, t, r));
		});
	}

	/** 获取频谱数据 */
	getVisualizerData(): number[] | null {
		if (!this.ctx) return null;
		for (const el of document.querySelectorAll('video, audio')) {
			const mediaEl = el as AudioMediaElement;
			if (mediaEl._vm?.analyser) {
				const data = new Uint8Array(mediaEl._vm.analyser.frequencyBinCount);
				mediaEl._vm.analyser.getByteFrequencyData(data);
				return Array.from(data);
			}
		}
		return null;
	}

	private handleCorsSuccess(): void {
		this.onCorsSuccess?.(window.location.hostname);
	}

	private handleCorsDetected(): void {
		this.onCorsDetected?.(window.location.hostname);
	}
}
