/**
 * 音频服务契约 (Audio Service Contracts)
 *
 * 定义音频引擎的所有公共接口和类型。
 * AI 在编写任何需要音频功能的代码时，只需读取此文件即可。
 *
 * @packageDocumentation
 */
import type { Result } from './common.types.js';
/**
 * 音频配置
 *
 * 存储每个标签页/域名的音频设置。
 */
export interface AudioConfig {
    /** 是否启用音频处理 */
    enabled: boolean;
    /** 音量 (0-800，100 为原始音量) */
    volume: number;
    /** 是否静音 */
    muted: boolean;
    /** 是否启用压缩器 (防爆音) */
    compressor: boolean;
    /** 是否强制单声道 */
    mono: boolean;
    /** 是否启用低音增强 */
    bass: boolean;
    /** 10段均衡器值 (-12 到 +12) */
    eqValues: number[];
}
/**
 * 音频配置默认值
 */
export declare const DEFAULT_AUDIO_CONFIG: Readonly<AudioConfig>;
/**
 * 音频处理模式
 */
export type AudioMode = 'NATIVE_WEBAUDIO' | 'NATIVE_LITE' | 'CAPTURE' | 'DISABLED';
/**
 * 音频状态 (运行时)
 */
export interface AudioState {
    /** 当前配置 */
    config: AudioConfig;
    /** 当前模式 */
    mode: AudioMode;
    /** 是否有音频元素 */
    hasAudio: boolean;
    /** 是否正在播放 */
    isPlaying: boolean;
    /** 用户是否已交互过 */
    userInteracted: boolean;
    /** 是否检测到 CORS */
    corsBlocked: boolean;
}
/**
 * 音频服务接口
 *
 * AI 在编写使用音频服务的代码时，只需了解这个接口。
 * 具体实现细节位于 `@nexus/audio-engine` 内部。
 *
 * @example
 * ```typescript
 * function createPlayer(audioService: IAudioService) {
 *   audioService.setVolume(150);
 *   audioService.on('stateChange', state => console.log(state));
 * }
 * ```
 */
export interface IAudioService {
    /** 获取当前音频状态 */
    getState(): AudioState;
    /** 获取可视化数据 (频谱分析) */
    getVisualizerData(): Float32Array | null;
    /** 设置音量 */
    setVolume(level: number): Result<void>;
    /** 切换静音 */
    toggleMute(): Result<boolean>;
    /** 更新配置 (部分更新) */
    updateConfig(config: Partial<AudioConfig>): Result<void>;
    /** 切换 Capture 模式 */
    setCaptureMode(enabled: boolean): Promise<Result<void>>;
    /** 监听状态变化 */
    on(event: 'stateChange', handler: (state: AudioState) => void): () => void;
    /** 监听 CORS 检测 */
    on(event: 'corsDetected', handler: () => void): () => void;
    /** 初始化服务 */
    init(): Promise<Result<void>>;
    /** 销毁服务，释放资源 */
    dispose(): void;
}
/**
 * URL 信息
 */
export interface UrlInfo {
    fullUrl: string;
    domain: string;
    pathname: string;
    isIframe: boolean;
}
/**
 * 策略上下文
 */
export interface PolicyContext {
    urlInfo: UrlInfo;
    hasMediaElement: boolean;
    hasAudioContext: boolean;
    userInteracted: boolean;
}
/**
 * 策略引擎接口
 *
 * 决定在特定网站上应该使用哪种音频处理模式。
 */
export interface IPolicyEngine {
    /** 计算应该使用的音频模式 */
    calculateMode(context: PolicyContext): AudioMode;
    /** 检查域名是否在黑名单 */
    isBlacklisted(domain: string): boolean;
    /** 获取域名的特殊规则 (如果有) */
    getRuleForDomain(domain: string): SiteRule | null;
}
/**
 * 站点规则
 */
export interface SiteRule {
    /** 规则类型 */
    type: 'whitelist' | 'blacklist' | 'force_capture' | 'force_native';
    /** 匹配模式 (支持通配符) */
    pattern: string;
    /** 原因说明 */
    reason?: string;
}
//# sourceMappingURL=audio.contracts.d.ts.map