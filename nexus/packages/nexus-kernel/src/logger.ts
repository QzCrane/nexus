/**
 * NEXUS Kernel - 统一日志模块
 * 
 * 所有 NEXUS 包共用的日志基础设施
 * 日志前缀统一为 [SPECTRA] 便于控制台过滤
 */

/** 日志前缀 */
const PREFIX = '[SPECTRA]';

/** Logger 接口 - 所有 logger 工厂函数必须实现 */
export interface Logger {
	log: (...args: unknown[]) => void;
	info: (...args: unknown[]) => void;
	warn: (...args: unknown[]) => void;
	error: (...args: unknown[]) => void;
	debug: (...args: unknown[]) => void;
	capture: (...args: unknown[]) => void;
}

/** 日志级别颜色 */
export const LOG_COLORS = {
	log: 'color: #3b82f6; font-weight: bold;',      // 蓝色
	info: 'color: #10b981; font-weight: bold;',     // 绿色
	warn: 'color: #f59e0b; font-weight: bold;',     // 橙色
	error: 'color: #ef4444; font-weight: bold;',    // 红色
	debug: 'color: #6b7280; font-weight: bold;',    // 灰色
	capture: 'color: #8b5cf6; font-weight: bold;',  // 紫色
	cors: 'color: #4CAF50; font-weight: bold;',     // CORS 绿色
};

/**
 * 创建带标签的日志器（带颜色）
 * @param tag - 模块标签 (如 'Content', 'Background', 'CORS')
 */
export function createLogger(tag: string): Logger {
	const fullPrefix = `${PREFIX} [${tag}]`;

	return {
		log: (...args: unknown[]) => console.log(`%c${fullPrefix}`, LOG_COLORS.log, ...args),
		info: (...args: unknown[]) => console.info(`%c${fullPrefix}`, LOG_COLORS.info, ...args),
		warn: (...args: unknown[]) => console.warn(`%c${fullPrefix}`, LOG_COLORS.warn, ...args),
		error: (...args: unknown[]) => console.error(`%c${fullPrefix}`, LOG_COLORS.error, ...args),
		debug: (...args: unknown[]) => console.debug(`%c${fullPrefix}`, LOG_COLORS.debug, ...args),
		capture: (...args: unknown[]) => console.log(`%c${fullPrefix} [CAPTURE]`, LOG_COLORS.capture, ...args),
	};
}

/**
 * 创建无颜色日志器（Service Worker 用）
 * Service Worker DevTools 不完全支持 %c
 */
export function createPlainLogger(tag: string): Logger {
	const fullPrefix = `${PREFIX} [${tag}]`;

	return {
		log: (...args: unknown[]) => console.log(fullPrefix, ...args),
		info: (...args: unknown[]) => console.info(fullPrefix, ...args),
		warn: (...args: unknown[]) => console.warn(fullPrefix, ...args),
		error: (...args: unknown[]) => console.error(fullPrefix, ...args),
		debug: (...args: unknown[]) => console.debug(fullPrefix, ...args),
		capture: (...args: unknown[]) => console.log(`${fullPrefix} [CAPTURE]`, ...args),
	};
}

/** CORS 日志样式 */
const CORS_PREFIX = `%c${PREFIX} [CORS]`;

/** 预创建的 CORS 检测日志器 - 统一绿色粗体样式 */
export const corsLogger = {
	log: (msg: string) => console.log(CORS_PREFIX, LOG_COLORS.cors, msg),
	check: (count: number, max: number, sum: number, hasData: boolean) =>
		console.log(CORS_PREFIX, LOG_COLORS.cors, `检测 #${count}/${max}: sum=${sum}, hasData=${hasData}`),
	safe: () => console.log(CORS_PREFIX, LOG_COLORS.cors, '✅ 结果: SAFE'),
	restricted: (max: number) => console.log(CORS_PREFIX, LOG_COLORS.cors, `❌ 结果: RESTRICTED (${max}次全零)`),
	waiting: () => console.log(CORS_PREFIX, LOG_COLORS.cors, '⏸️ 媒体未播放，等待 play 事件...'),
	resumed: () => console.log(CORS_PREFIX, LOG_COLORS.cors, '▶️ 检测到 play 事件，重置检测'),
	start: (hostname: string, el: HTMLMediaElement) =>
		console.log(CORS_PREFIX, LOG_COLORS.cors, `开始检测 ${hostname}，paused=${el.paused}, muted=${el.muted}, volume=${el.volume}`),
};

