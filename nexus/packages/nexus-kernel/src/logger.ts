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

/** 预创建的 CORS 检测日志器 */
export const corsLogger = {
	...createLogger('CORS'),
	check: (count: number, max: number, sum: number, hasData: boolean) =>
		console.log(`${PREFIX} [CORS] 检测 #${count}/${max}: 数据总和=${sum}, hasData=${hasData}`),
	safe: () => console.log(`${PREFIX} [CORS] ✅ 结果: SAFE (有音频数据)`),
	restricted: (max: number) => console.log(`${PREFIX} [CORS] ❌ 结果: RESTRICTED (${max}次全零)`),
	waiting: () => console.log(`${PREFIX} [CORS] ⏸️ 媒体未播放，等待 play 事件...`),
	resumed: () => console.log(`${PREFIX} [CORS] ▶️ 检测到 play 事件，重置检测`),
	start: (hostname: string, el: HTMLMediaElement) =>
		console.log(`${PREFIX} [CORS] 开始检测 ${hostname}，媒体状态: paused=${el.paused}, muted=${el.muted}, volume=${el.volume}`),
};
