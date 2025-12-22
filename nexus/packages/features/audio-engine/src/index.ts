/**
 * NEXUS Audio Engine - 主入口
 * 
 * SPECTRA 的核心音频处理引擎，提供:
 * 1. PolicyEngine - 音频处理模式策略引擎
 * 2. WebAudioController - WebAudio 音频图控制器
 * 3. 常量定义 - 音频参数、站点规则等
 * 4. 颜色预判 - 统一的 CAPTURE 模式颜色判断
 */

// 常量和类型
export * from './constants.js';

// 策略引擎
export { PolicyEngine } from './PolicyEngine.js';
export type { PolicyContext, UrlInfo } from '@nexus/contracts';

// WebAudio 控制器
export { WebAudioController } from './WebAudioController.js';
export type { CorsDetectedCallback } from './WebAudioController.js';

// 颜色预判
export { predictCapture, needsAdvancedProcessing } from './color-predictor.js';
export type { ColorContext } from './color-predictor.js';
