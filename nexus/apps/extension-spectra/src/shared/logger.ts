/**
 * SPECTRA - 统一日志模块
 * 
 * 所有日志输出都使用 [SPECTRA] 前缀，方便在控制台中过滤
 * 
 * 使用方法:
 * - 在控制台过滤器输入 `[SPECTRA]` 即可只显示扩展日志
 */

/** 日志前缀 */
const PREFIX = '[SPECTRA]';

/** 日志级别颜色 */
const COLORS = {
	log: 'color: #3b82f6; font-weight: bold;',      // 蓝色
	info: 'color: #10b981; font-weight: bold;',     // 绿色
	warn: 'color: #f59e0b; font-weight: bold;',     // 橙色
	error: 'color: #ef4444; font-weight: bold;',    // 红色
	debug: 'color: #6b7280; font-weight: bold;',    // 灰色
	capture: 'color: #8b5cf6; font-weight: bold;',  // 紫色 (Capture 模式专用)
};

/**
 * 创建带标签的日志器
 * @param tag - 模块标签 (如 'Content', 'Background', 'Popup')
 */
export function createLogger(tag: string) {
	const fullPrefix = `${PREFIX} [${tag}]`;

	return {
		/** 普通日志 */
		log(...args: unknown[]) {
			console.log(`%c${fullPrefix}`, COLORS.log, ...args);
		},

		/** 信息日志 */
		info(...args: unknown[]) {
			console.info(`%c${fullPrefix}`, COLORS.info, ...args);
		},

		/** 警告日志 */
		warn(...args: unknown[]) {
			console.warn(`%c${fullPrefix}`, COLORS.warn, ...args);
		},

		/** 错误日志 */
		error(...args: unknown[]) {
			console.error(`%c${fullPrefix}`, COLORS.error, ...args);
		},

		/** 调试日志 (仅开发时显示) */
		debug(...args: unknown[]) {
			console.debug(`%c${fullPrefix}`, COLORS.debug, ...args);
		},

		/** Capture 模式专用日志 (紫色) */
		capture(...args: unknown[]) {
			console.log(`%c${fullPrefix} [CAPTURE]`, COLORS.capture, ...args);
		},

		/** 模式切换日志 */
		mode(from: string | null, to: string) {
			console.log(`%c${fullPrefix} Mode: ${from || 'null'} -> ${to}`, COLORS.info);
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
 * Service Worker 专用日志器 (不带颜色，因为 SW DevTools 不完全支持 %c)
 * 用于 Background Script
 */
export const swLog = {
	log(...args: unknown[]) {
		console.log('[SPECTRA] [Background]', ...args);
	},
	info(...args: unknown[]) {
		console.info('[SPECTRA] [Background]', ...args);
	},
	warn(...args: unknown[]) {
		console.warn('[SPECTRA] [Background]', ...args);
	},
	error(...args: unknown[]) {
		console.error('[SPECTRA] [Background]', ...args);
	},
	debug(...args: unknown[]) {
		console.debug('[SPECTRA] [Background]', ...args);
	},
	capture(...args: unknown[]) {
		console.log('[SPECTRA] [Background] [CAPTURE]', ...args);
	},
};
