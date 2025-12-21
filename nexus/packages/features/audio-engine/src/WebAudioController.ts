/**
 * NEXUS Audio Engine - WebAudio 控制器 (WebAudioController)
 * 
 * 从原 VolumeBooster content.js 迁移，负责管理 WebAudio 音频处理图。
 * 
 * 核心职责：
 * 1. 创建和管理 AudioContext 生命周期
 * 2. 将媒体元素连接到音频处理链 (Gain -> Bass -> EQ -> Compressor -> Analyser)
 * 3. 实时更新音频参数 (音量、EQ、压缩器等)
 * 4. 提供频谱分析数据
 */

import { AudioParams, CompressorOn, CompressorNativeOff } from './constants.js';

// 本地定义 AudioConfig 类型 (与 @nexus/kernel 中的定义保持一致)
// 这样可以避免复杂的 TypeScript 项目引用问题

// ============================================
// 类型定义
// ============================================

/** 音频配置结构 (与 @nexus/kernel 中定义保持同步) */
export interface AudioConfig {
  enabled: boolean;
  volume: number;        // 0-800
  muted: boolean;
  compressor: boolean;
  mono: boolean;
  bass: boolean;
  eqValues: number[];    // 10段 EQ，范围 -12 到 +12
}

/** 附加到媒体元素的音频节点集合 */
interface AudioNodeSet {
  /** 音频源节点 */
  source: MediaElementAudioSourceNode;
  /** 增益节点 (音量控制) */
  gain: GainNode;
  /** 低音滤波器 */
  bass: BiquadFilterNode;
  /** 动态压缩器 */
  comp: DynamicsCompressorNode;
  /** 10 段均衡器节点 */
  eqNodes: BiquadFilterNode[];
  /** 频谱分析器 */
  analyser: AnalyserNode;
}

/** 扩展的 HTMLMediaElement，包含音频节点 */
interface AudioMediaElement extends HTMLMediaElement {
  _vm?: AudioNodeSet;
}

/** CORS 检测及成功回调 */
export type CorsDetectedCallback = (hostname: string) => void;
export type CorsSuccessCallback = (hostname: string) => void;

// ============================================
// WebAudio 控制器
// ============================================

/**
 * WebAudio 控制器类
 * 
 * 用法:
 * ```typescript
 * const controller = new WebAudioController();
 * 
 * // 初始化音频上下文
 * controller.initialize();
 * 
 * // 扫描并附加媒体元素
 * controller.scanAndAttach();
 * 
 * // 更新参数
 * controller.updateParams({ volume: 150, muted: false, ... });
 * 
 * // 获取频谱数据
 * const spectrum = controller.getVisualizerData();
 * 
 * // 清理
 * controller.cleanup();
 * ```
 */
export class WebAudioController {
  private ctx: AudioContext | null = null;
  private onCorsDetected: CorsDetectedCallback | null = null;
  private onCorsSuccess: CorsSuccessCallback | null = null;

  // ============================================
  // 生命周期管理
  // ============================================

  /**
   * 初始化 AudioContext
   * 
   * 注意：应在用户手势上下文中调用，否则 AudioContext 可能处于 suspended 状态。
   * 
   * @returns true 表示初始化成功或已就绪，false 表示需要等待用户手势
   */
  async initialize(): Promise<boolean> {
    // 如果已有可用的上下文，尝试恢复
    if (this.ctx && this.ctx.state !== 'closed') {
      if (this.ctx.state === 'suspended') {
        try {
          await this.ctx.resume();
        } catch (e) {
          // 恢复失败
          return false;
        }
      }
      return this.ctx.state === 'running';
    }

    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();

      // 检查初始状态
      if (this.ctx.state === 'suspended') {
        // 只有在这里尝试 resume，如果失败了也不要在控制台报错（通常是因为无手势）
        this.ctx.resume().catch(() => {
          // 静默处理：这在无用户手势时是预期的
        });
      }

      // 如果仍然是 suspended，视为暂时初始化失败，返回 false 让外部逻辑回退
      if (this.ctx.state !== 'running') {
        return false;
      }

      return true;
    } catch (e) {
      // 这里的捕获通常是浏览器完全不支持 AudioContext
      return false;
    }
  }

  /**
   * 进入旁通模式 (而非销毁)
   * 
   * 重要：MediaElementAudioSourceNode 一旦创建就无法断开。
   * 关闭 AudioContext 会导致媒体元素无法播放（视频卡死）。
   * 因此改为将增益设为 1、禁用所有效果，保持音频链路畅通。
   */
  cleanup(): void {
    if (!this.ctx) return;

    // 不再关闭 AudioContext，改为设置旁通参数
    const t = this.ctx.currentTime;
    const r = AudioParams.SMOOTH_TIME_FAST;

    document.querySelectorAll('video, audio').forEach((el) => {
      const mediaEl = el as AudioMediaElement;
      if (!mediaEl._vm) return;

      const { gain, bass, comp, eqNodes } = mediaEl._vm;

      // 增益设为 1 (透传)
      gain.gain.setTargetAtTime(1, t, r);
      gain.channelCount = 2;

      // 禁用低音增强
      bass.gain.setTargetAtTime(0, t, r);

      // 禁用压缩器
      comp.threshold.setTargetAtTime(CompressorNativeOff.threshold, t, r);
      comp.ratio.setTargetAtTime(CompressorNativeOff.ratio, t, r);

      // EQ 归零
      eqNodes.forEach((node) => {
        node.gain.setTargetAtTime(0, t, r);
      });
    });
  }

  /**
   * 检查 AudioContext 是否可用
   */
  isReady(): boolean {
    return this.ctx !== null && this.ctx.state !== 'closed';
  }

  /**
   * 设置检测回调
   */
  setCallbacks(onDetected: CorsDetectedCallback, onSuccess: CorsSuccessCallback): void {
    this.onCorsDetected = onDetected;
    this.onCorsSuccess = onSuccess;
  }

  // ============================================
  // 节点管理
  // ============================================

  /**
   * 扫描页面中的所有媒体元素并附加音频节点
   */
  scanAndAttach(): number {
    if (!this.ctx) return 0;

    let attached = 0;
    document.querySelectorAll('video, audio').forEach((el) => {
      if (this.attachNode(el as HTMLMediaElement)) {
        attached++;
      }
    });

    return attached;
  }

  /**
   * 附加音频处理节点到单个媒体元素
   * 
   * 音频处理链:
   * Source -> Gain -> Bass -> EQ[0-9] -> Compressor -> Analyser -> Destination
   */
  attachNode(el: HTMLMediaElement): boolean {
    const mediaEl = el as AudioMediaElement;

    // 检查是否已附加
    if (mediaEl._vm || mediaEl.dataset.vmAttached === 'true') {
      return false;
    }

    if (!this.ctx) return false;

    try {
      // 设置 crossOrigin 以支持跨域音频处理
      if (!el.crossOrigin && el.src && !el.src.startsWith('data:') && !el.src.startsWith('blob:')) {
        el.crossOrigin = 'anonymous';
      }

      // 创建音频节点
      const source = this.ctx.createMediaElementSource(el);
      this.handleCorsSuccess();

      const gain = this.ctx.createGain();
      const bass = this.ctx.createBiquadFilter();
      bass.type = 'lowshelf';
      bass.frequency.value = AudioParams.BASS_FREQUENCY;

      const comp = this.ctx.createDynamicsCompressor();
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = AudioParams.FFT_SIZE;

      // 创建 10 段均衡器
      const eqNodes = AudioParams.EQ_FREQUENCIES.map((freq) => {
        const node = this.ctx!.createBiquadFilter();
        node.type = 'peaking';
        node.frequency.value = freq;
        node.Q.value = AudioParams.EQ_Q;
        return node;
      });

      // 连接音频处理链
      // Source -> Gain -> Bass -> EQ[0] -> EQ[1] -> ... -> EQ[9] -> Comp -> Analyser -> Destination
      let head: AudioNode = source;
      head.connect(gain);
      head = gain;

      head.connect(bass);
      head = bass;

      eqNodes.forEach((node) => {
        head.connect(node);
        head = node;
      });

      head.connect(comp);
      head = comp;

      head.connect(analyser);
      analyser.connect(this.ctx.destination);

      // 保存节点引用
      mediaEl._vm = { source, gain, bass, comp, eqNodes, analyser };
      mediaEl.dataset.vmAttached = 'true';

      // 添加播放事件监听器，确保 AudioContext 在播放时恢复
      const resumeHandler = () => {
        if (this.ctx && this.ctx.state === 'suspended') {
          this.ctx.resume().catch(() => { });
        }
      };
      el.addEventListener('play', resumeHandler);

      return true;
    } catch (e) {
      // CORS 限制或其他错误
      this.handleCorsDetected();
      return false;
    }
  }

  // ============================================
  // 参数更新
  // ============================================

  /**
   * 更新所有已附加媒体元素的音频参数
   */
  updateParams(config: AudioConfig): void {
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const r = AudioParams.SMOOTH_TIME_FAST;
    const v = config.muted ? 0 : config.volume / 100; // 0.0 - 8.0

    document.querySelectorAll('video, audio').forEach((el) => {
      const mediaEl = el as AudioMediaElement;
      if (!mediaEl._vm) return;

      const { gain, bass, comp, eqNodes } = mediaEl._vm;

      // 音量
      gain.gain.setTargetAtTime(v, t, r);
      gain.channelCount = config.mono ? 1 : 2;

      // 低音增强
      bass.gain.setTargetAtTime(config.bass ? AudioParams.BASS_GAIN : 0, t, r);

      // 压缩器
      if (config.compressor) {
        comp.threshold.setTargetAtTime(CompressorOn.threshold, t, r);
        comp.ratio.setTargetAtTime(CompressorOn.ratio, t, r);
      } else {
        comp.threshold.setTargetAtTime(CompressorNativeOff.threshold, t, r);
        comp.ratio.setTargetAtTime(CompressorNativeOff.ratio, t, r);
      }

      // 均衡器
      eqNodes.forEach((node, i) => {
        const eqValue = config.eqValues[i] ?? 0;
        node.gain.setTargetAtTime(eqValue, t, r);
      });
    });
  }

  // ============================================
  // 频谱分析
  // ============================================

  /**
   * 获取频谱可视化数据
   * 
   * @returns 频谱数据数组，如果没有可用的分析器则返回 null
   */
  getVisualizerData(): number[] | null {
    if (!this.ctx) return null;

    // 找到第一个有分析器的媒体元素
    const mediaElements = document.querySelectorAll('video, audio');
    for (const el of mediaElements) {
      const mediaEl = el as AudioMediaElement;
      if (mediaEl._vm?.analyser) {
        const analyser = mediaEl._vm.analyser;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(dataArray);
        return Array.from(dataArray);
      }
    }

    return null;
  }

  // ============================================
  // 私有方法
  // ============================================

  /**
   * 处理 CORS 检测成功
   */
  private handleCorsSuccess(): void {
    if (this.onCorsSuccess) {
      this.onCorsSuccess(window.location.hostname);
    }
  }

  /**
   * 处理 CORS 检测失败 (受限)
   */
  private handleCorsDetected(): void {
    if (this.onCorsDetected) {
      this.onCorsDetected(window.location.hostname);
    }
  }
}
