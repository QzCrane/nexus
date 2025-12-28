/**
 * // goal: Handle audio processing in offscreen document
 * // eff: Creates WebAudio chain (Source -> Gain -> Bass -> EQ -> Comp -> Panner -> Delay -> Analyser -> Dest)
 */

import { AudioParams, CompressorOn, CompressorNativeOff } from '@nexus/audio-engine';
import type { AudioConfig } from '@nexus/kernel';
import { OffscreenActions } from '@nexus/contracts';

interface AudioProcessor {
	ctx: AudioContext;
	stream: MediaStream;
	gain: GainNode;
	bass: BiquadFilterNode;
	comp: DynamicsCompressorNode;
	eqNodes: BiquadFilterNode[];
	panner: StereoPannerNode;
	delayNode: DelayNode;
	analyser: AnalyserNode;
}

const processors = new Map<number, AudioProcessor>();

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
			return true; // async response
		}
	}
});

/**
 * // pre: valid tabId and streamId
 * // eff: Initializes AudioContext and node graph
 */
async function startCapture(tabId: number, streamId: string, config: AudioConfig): Promise<void> {
	if (processors.has(tabId)) return;

	try {
		// eff: Get MediaStream
		const stream = await navigator.mediaDevices.getUserMedia({
			audio: {
				mandatory: {
					chromeMediaSource: 'tab',
					chromeMediaSourceId: streamId
				}
			} as any,
			video: false
		});


		const ctx = new AudioContext();

		// eff: Build Chain
		const source = ctx.createMediaStreamSource(stream);
		const gain = ctx.createGain();


		const bass = ctx.createBiquadFilter();
		bass.type = 'lowshelf';
		bass.frequency.value = AudioParams.BASS_FREQUENCY;


		const comp = ctx.createDynamicsCompressor();


		const analyser = ctx.createAnalyser();
		analyser.fftSize = AudioParams.FFT_SIZE;


		const eqNodes = AudioParams.EQ_FREQUENCIES.map(f => {
			const n = ctx.createBiquadFilter();
			n.type = 'peaking';
			n.frequency.value = f;
			n.Q.value = AudioParams.EQ_Q;
			return n;
		});


		const panner = ctx.createStereoPanner();
		const delayNode = ctx.createDelay(1); // inv: Max 1s

		// eff: Connect Nodes
		let head: AudioNode = source;
		head.connect(gain); head = gain;
		head.connect(bass); head = bass;
		eqNodes.forEach(n => { head.connect(n); head = n; });
		head.connect(comp); head = comp;
		head.connect(panner); head = panner;
		head.connect(delayNode); head = delayNode;
		head.connect(analyser);
		analyser.connect(ctx.destination);

		// rule: Force Resume
		if (ctx.state === 'suspended') {
			await ctx.resume();
		}


		processors.set(tabId, { ctx, stream, gain, bass, comp, eqNodes, panner, delayNode, analyser });


		updateAudio(tabId, config);
	} catch (e) {
		console.error('[SPECTRA] Offscreen capture failed:', e);
	}
}

function stopCapture(tabId: number): void {
	const p = processors.get(tabId);
	if (p) {
		p.stream.getTracks().forEach(t => t.stop());
		p.ctx.close();
		processors.delete(tabId);
	}
}

function updateAudio(tabId: number, config: AudioConfig): void {
	const p = processors.get(tabId);
	if (!p) return;

	if (p.ctx.state === 'suspended') {
		p.ctx.resume();
	}

	// rule: Gain 0-100% -> 0.0-1.0, 100-800% -> 1.0-8.0
	const val = config.muted ? 0 : config.volume;
	const gainVal = val / 100;

	const t = p.ctx.currentTime;
	const r = AudioParams.SMOOTH_TIME;

	p.gain.gain.setTargetAtTime(gainVal, t, r);
	p.gain.channelCount = config.mono ? 1 : 2;


	p.bass.gain.setTargetAtTime(config.bass ? AudioParams.BASS_GAIN : 0, t, r);


	p.eqNodes.forEach((n, i) => {
		n.gain.setTargetAtTime(config.eqValues?.[i] || 0, t, r);
	});


	if (config.compressor) {
		p.comp.threshold.setTargetAtTime(CompressorOn.threshold, t, r);
		p.comp.knee.setTargetAtTime(CompressorOn.knee, t, r);
		p.comp.ratio.setTargetAtTime(CompressorOn.ratio, t, r);
		p.comp.attack.setTargetAtTime(CompressorOn.attack, t, r);
		p.comp.release.setTargetAtTime(CompressorOn.release, t, r);
	} else {
		// rule: Transparent params when off
		p.comp.threshold.setTargetAtTime(CompressorNativeOff.threshold, t, r);
		p.comp.ratio.setTargetAtTime(CompressorNativeOff.ratio, t, r);
	}


	p.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, config.pan ?? 0)), t, r);

	// rule: ms to s
	const delayMs = Math.max(0, config.delay ?? 0);
	p.delayNode.delayTime.setTargetAtTime(delayMs / 1000, t, r);
}
