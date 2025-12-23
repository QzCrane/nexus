/**
 * SPECTRA - 扩展日志模块
 * 
 * 基于 @nexus/kernel 的日志基础设施，添加扩展专用功能
 * 所有日志输出使用 [SPECTRA] 前缀，方便在控制台中过滤
 */

import { createLogger as kernelCreateLogger, createPlainLogger, LOG_COLORS } from '@nexus/kernel';

// 重导出 kernel 的基础日志功能
export { createPlainLogger, LOG_COLORS } from '@nexus/kernel';

/**
 * 创建扩展日志器（带 capture 和 mode 方法）
 * @param tag - 模块标签 (如 'Content', 'Background', 'Popup')
 */
export function createLogger(tag: string) {
	const base = kernelCreateLogger(tag);
	const fullPrefix = `[SPECTRA] [${tag}]`;

	return {
		...base,

		/** Capture 模式专用日志 (紫色) */
		capture(...args: unknown[]) {
			console.log(`%c${fullPrefix} [CAPTURE]`, LOG_COLORS.capture, ...args);
		},

		/** 模式切换日志 */
		mode(from: string | null, to: string) {
			console.log(`%c${fullPrefix} Mode: ${from || 'null'} -> ${to}`, LOG_COLORS.info);
		},
	};
}

/** 预创建的常用日志器 */
export const logger = {
	content: createLogger('Content'),
	background: createLogger('Background'),
	popup: createLogger('Popup'),
	offscreen: createLogger('Offscreen'),
};

/**
 * Service Worker 专用日志器 (不带颜色)
 * 用于 Background Script
 */
export const swLog = createPlainLogger('Background');

