/**
 * NEXUS 音频引擎 - 颜色预判工具
 * 
 * 统一所有组件的颜色判断逻辑，基于策略预判而非激活状态
 */

import type { AudioConfig } from '@nexus/contracts';

/**
 * 颜色判断上下文
 */
export interface ColorContext {
	/** 音频配置 */
	config: AudioConfig;
	/** 是否受限站点 */
	isRestricted: boolean;
	/** 频谱可视化是否开启 */
	visualizerEnabled: boolean;
}

/**
 * 判断是否有高级音频需求
 * 
 * 任一条件满足即返回 true：
 * - 音量 > 100%
 * - 频谱开启
 * - EQ 非零
 * - 压缩器开启
 * - 低音增强开启
 */
export function needsAdvancedProcessing(ctx: ColorContext): boolean {
	const { config, visualizerEnabled } = ctx;
	return (
		config.volume > 100 ||
		visualizerEnabled ||
		config.eqValues?.some(v => v !== 0) ||
		config.compressor ||
		config.bass
	);
}

/**
 * 预判是否应该使用 CAPTURE 模式（紫色）
 * 
 * 规则：受限站点 + 有高级需求 = CAPTURE
 */
export function predictCapture(ctx: ColorContext): boolean {
	return ctx.isRestricted && needsAdvancedProcessing(ctx);
}
