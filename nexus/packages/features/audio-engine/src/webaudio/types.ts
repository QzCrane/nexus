/**
 * NEXUS Audio Engine - WebAudio 类型
 */

/** 音频配置结构 */
export interface AudioConfig {
	enabled: boolean;
	volume: number;
	muted: boolean;
	compressor: boolean;
	mono: boolean;
	bass: boolean;
	eqValues: number[];
}

/** 附加到媒体元素的音频节点集合 */
export interface AudioNodeSet {
	source: MediaElementAudioSourceNode;
	gain: GainNode;
	bass: BiquadFilterNode;
	comp: DynamicsCompressorNode;
	eqNodes: BiquadFilterNode[];
	analyser: AnalyserNode;
}

/** 扩展的 HTMLMediaElement */
export interface AudioMediaElement extends HTMLMediaElement {
	_vm?: AudioNodeSet;
}

/** CORS 回调类型 */
export type CorsDetectedCallback = (hostname: string) => void;
export type CorsSuccessCallback = (hostname: string) => void;
