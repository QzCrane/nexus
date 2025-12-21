/**
 * SPECTRA Offscreen Document - 音频处理
 * 
 * 职责：处理 Tab Capture 模式下的音频
 * - 接收来自 Background 的流 ID
 * - 创建 WebAudio 处理链
 * - 应用音量/EQ/压缩/低音增强
 */

import { AudioParams, CompressorOn, CompressorNativeOff } from '@nexus/audio-engine';
import type { AudioConfig } from '@nexus/kernel';
import { OffscreenActions } from '@nexus/contracts';

/** 音频处理器实例 */
interface AudioProcessor {
	ctx: AudioContext;
	stream: MediaStream;
	gain: GainNode;
	bass: BiquadFilterNode;
	comp: DynamicsCompressorNode;
	eqNodes: BiquadFilterNode[];
	analyser: AnalyserNode;
}

const processors = new Map<number, AudioProcessor>();

// 消息监听
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
	if (msg.target !== 'offscreen') return;

	switch (msg.action) {
		case OffscreenActions.OFFSCREEN_START:
			startCapture(msg.tabId, msg.streamId, msg.config);
			break;
		case OffscreenActions.OFFSCREEN_STOP:
			stopCapture(msg.tabId);
			break;
		case OffscreenActions.OFFSCREEN_UPDATE_CONFIG:
			updateAudio(msg.tabId, msg.config);
			break;
		case OffscreenActions.OFFSCREEN_GET_VIZ: {
			const p = processors.get(msg.tabId);
			if (p?.analyser) {
				const data = new Uint8Array(p.analyser.frequencyBinCount);
				p.analyser.getByteFrequencyData(data);
				sendResponse({ buffer: Array.from(data) });
			} else {
				sendResponse({ buffer: null });
			}
			return true; // 异步响应
		}
	}
});

/**
 * 开始捕获并处理音频
 */
async function startCapture(tabId: number, streamId: string, config: AudioConfig): Promise<void> {
	if (processors.has(tabId)) return;

	try {
		// 1. 获取来自 Tab 的媒体流
		const stream = await navigator.mediaDevices.getUserMedia({
			audio: {
				mandatory: {
					chromeMediaSource: 'tab',
					chromeMediaSourceId: streamId
				}
			} as any,
			video: false
		});

		// 2. 创建 AudioContext
		const ctx = new AudioContext();

		// 3. 构建处理链路：Source -> Bass -> EQ -> Comp -> Gain -> Analyser -> Destination
		const source = ctx.createMediaStreamSource(stream);
		const gain = ctx.createGain();

		// 低音增强 (Bass Boost)
		const bass = ctx.createBiquadFilter();
		bass.type = 'lowshelf';
		bass.frequency.value = AudioParams.BASS_FREQUENCY;

		// 动态压缩器 (Compressor)
		const comp = ctx.createDynamicsCompressor();

		// 分析器 (Visualizer)
		const analyser = ctx.createAnalyser();
		analyser.fftSize = AudioParams.FFT_SIZE;

		// 10段均衡器 (EQ)
		const eqNodes = AudioParams.EQ_FREQUENCIES.map(f => {
			const n = ctx.createBiquadFilter();
			n.type = 'peaking';
			n.frequency.value = f;
			n.Q.value = AudioParams.EQ_Q;
			return n;
		});

		// 4. 连接节点
		let head: AudioNode = source;
		head.connect(bass);
		head = bass;
		eqNodes.forEach(n => {
			head.connect(n);
			head = n;
		});
		head.connect(comp);
		head = comp;
		head.connect(gain);
		head = gain;
		head.connect(analyser);
		analyser.connect(ctx.destination);

		// 5. 强制 Resume AudioContext
		if (ctx.state === 'suspended') {
			await ctx.resume();
		}

		// 保存处理器状态
		processors.set(tabId, { ctx, stream, gain, bass, comp, eqNodes, analyser });

		// 立即应用配置
		updateAudio(tabId, config);
	} catch (e) {
		console.error('[SPECTRA] Offscreen capture failed:', e);
	}
}

/**
 * 停止捕获
 */
function stopCapture(tabId: number): void {
	const p = processors.get(tabId);
	if (p) {
		p.stream.getTracks().forEach(t => t.stop());
		p.ctx.close();
		processors.delete(tabId);
	}
}

/**
 * 更新音频参数
 */
function updateAudio(tabId: number, config: AudioConfig): void {
	const p = processors.get(tabId);
	if (!p) return;

	// 确保 AudioContext 处于运行状态
	if (p.ctx.state === 'suspended') {
		p.ctx.resume();
	}

	// 计算 Gain 值：0-100% -> 0.0-1.0, 100-800% -> 1.0-8.0
	const val = config.muted ? 0 : config.volume;
	const gainVal = val / 100;

	const t = p.ctx.currentTime;
	const r = AudioParams.SMOOTH_TIME;

	// 应用音量
	p.gain.gain.setTargetAtTime(gainVal, t, r);
	p.gain.channelCount = config.mono ? 1 : 2;

	// 应用低音
	p.bass.gain.setTargetAtTime(config.bass ? AudioParams.BASS_GAIN : 0, t, r);

	// 应用 EQ
	p.eqNodes.forEach((n, i) => {
		n.gain.setTargetAtTime(config.eqValues?.[i] || 0, t, r);
	});

	// 应用压缩器参数
	if (config.compressor) {
		p.comp.threshold.setTargetAtTime(CompressorOn.threshold, t, r);
		p.comp.knee.setTargetAtTime(CompressorOn.knee, t, r);
		p.comp.ratio.setTargetAtTime(CompressorOn.ratio, t, r);
		p.comp.attack.setTargetAtTime(CompressorOn.attack, t, r);
		p.comp.release.setTargetAtTime(CompressorOn.release, t, r);
	} else {
		// 关闭压缩器时，使用透明参数
		p.comp.threshold.setTargetAtTime(CompressorNativeOff.threshold, t, r);
		p.comp.ratio.setTargetAtTime(CompressorNativeOff.ratio, t, r);
	}
}
