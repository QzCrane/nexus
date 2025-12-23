/**
 * NEXUS Kernel - 统一日志模块
 * 
 * 所有 NEXUS 包共用的日志基础设施
 * 日志前缀统一为 [SPECTRA] 便于控制台过滤
 */

/** 日志前缀 */
const PREFIX = '[SPECTRA]';

/**
 * 创建带标签的日志器
 * @param tag - 模块标签 (如 'Content', 'AudioEngine', 'CORS')
 */
export function createLogger(tag: string) {
	const fullPrefix = `${PREFIX} [${tag}]`;

	return {
		log: (...args: unknown[]) => console.log(fullPrefix, ...args),
		info: (...args: unknown[]) => console.info(fullPrefix, ...args),
		warn: (...args: unknown[]) => console.warn(fullPrefix, ...args),
		error: (...args: unknown[]) => console.error(fullPrefix, ...args),
		debug: (...args: unknown[]) => console.debug(fullPrefix, ...args),
	};
}

/** CORS 日志样式 */
const CORS_STYLE = 'color: #4CAF50; font-weight: bold';
const CORS_PREFIX = `%c${PREFIX} [CORS]`;

/** 预创建的 CORS 检测日志器 - 统一绿色粗体样式 */
export const corsLogger = {
	log: (msg: string) => console.log(CORS_PREFIX, CORS_STYLE, msg),
	check: (count: number, max: number, sum: number, hasData: boolean) =>
		console.log(CORS_PREFIX, CORS_STYLE, `检测 #${count}/${max}: sum=${sum}, hasData=${hasData}`),
	safe: () => console.log(CORS_PREFIX, CORS_STYLE, '✅ 结果: SAFE'),
	restricted: (max: number) => console.log(CORS_PREFIX, CORS_STYLE, `❌ 结果: RESTRICTED (${max}次全零)`),
	waiting: () => console.log(CORS_PREFIX, CORS_STYLE, '⏸️ 媒体未播放，等待 play 事件...'),
	resumed: () => console.log(CORS_PREFIX, CORS_STYLE, '▶️ 检测到 play 事件，重置检测'),
	start: (hostname: string, el: HTMLMediaElement) =>
		console.log(CORS_PREFIX, CORS_STYLE, `开始检测 ${hostname}，paused=${el.paused}, muted=${el.muted}, volume=${el.volume}`),
};

