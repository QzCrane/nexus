/**
 * CORS 数据检查器 (v3.11)
 * 
 * 通过读取 AnalyserNode 数据判断 CORS 状态
 * CORS 限制会导致数据全零
 * 
 * v3.11: 简化检测策略
 *   - 延迟 500ms 后直接启动观察模式
 *   - 每 500ms 检测一次，持续 6 秒
 *   - 期间检测到数据 → SAFE，超时 → RESTRICTED
 * v3.9: 增强预览视频识别
 * v3.8: 修复B站浏览页误判问题
 */

import { corsLogger as corsLog } from '@nexus/kernel';

export type CorsCheckCallback = (restricted: boolean) => void;

/**
 * 检查媒体元素是否是"主视频"，值得进行 CORS 判定
 * 
 * 只有满足以下条件的元素才进行 CORS 判定：
 * - 非静音、非循环
 * - 尺寸足够大（排除小的广告/封面视频）
 * - 非预览视频
 * 
 * @returns true = 是主视频，应检测；false = 应跳过
 */
function isMainVideo(el: HTMLMediaElement): boolean {
	// 检查 1: 使用 audioTracks API (部分浏览器支持)
	const audioTracks = (el as HTMLVideoElement & { audioTracks?: { length: number } }).audioTracks;
	if (audioTracks && audioTracks.length === 0) {
		return false; // 明确无音频轨道
	}

	// 检查 2: 静音状态 = 无法检测 CORS
	if (el.muted) {
		return false;
	}

	// 检查 3: 循环播放 = 大概率是预览/背景视频
	if (el.loop) {
		return false;
	}

	// 检查 4: src 包含预览关键词
	const src = el.src || el.currentSrc || '';
	const previewKeywords = ['preview', 'thumb', 'poster', 'cover', 'banner', 'ad', 'logo'];
	if (previewKeywords.some(kw => src.toLowerCase().includes(kw))) {
		return false;
	}

	// 检查 5: 视频尺寸过小 = 可能是广告/封面
	if (el instanceof HTMLVideoElement) {
		// 视频宽度或高度小于 200px，认为是小视频
		if (el.videoWidth > 0 && el.videoWidth < 200) return false;
		if (el.videoHeight > 0 && el.videoHeight < 150) return false;

		// 元素在页面上的可见尺寸也要检查
		const rect = el.getBoundingClientRect();
		if (rect.width < 200 || rect.height < 150) return false;
	}

	// 检查 6: 短视频 (<30s) 且音量很低 = 可能是预览
	if (el.duration > 0 && el.duration < 30 && el.volume < 0.3) {
		return false;
	}

	return true;
}

// 保留旧函数名作为别名，保持兼容
const hasActiveAudio = isMainVideo;

/**
 * CORS 状态检测
 * 
 * v3.11 策略（简化版）：
 * - 延迟 500ms 后开始观察
 * - 每 500ms 检测一次，持续 6 秒
 * - 期间任意检测到数据 → SAFE
 * - 超时仍无数据 → RESTRICTED
 * 
 * @param analyser 要检查的 AnalyserNode
 * @param el 媒体元素（用于检查播放状态）
 * @param onResult 回调函数(true=RESTRICTED, false=SAFE)
 */
export function scheduleCorsCheck(
	analyser: AnalyserNode,
	el: HTMLMediaElement,
	onResult: CorsCheckCallback
): void {
	const observeTimeout = 6000;   // 观察超时 (6秒)
	const observeInterval = 500;   // 观察间隔
	const startDelay = 500;        // 启动延迟
	let settled = false;
	let observeTimer: ReturnType<typeof setInterval> | null = null;
	let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
	const hostname = window.location.hostname;

	corsLog.start(hostname, el);

	// 清理函数
	const cleanup = () => {
		if (observeTimer) clearInterval(observeTimer);
		if (timeoutTimer) clearTimeout(timeoutTimer);
	};

	// 检测音频数据
	const hasAudioData = (): boolean => {
		const data = new Uint8Array(analyser.frequencyBinCount);
		analyser.getByteFrequencyData(data);
		const sum = data.reduce((a, b) => a + b, 0);
		if (sum > 0) corsLog.log(`📊 ${hostname}: 检测到音频数据 (sum=${sum})`);
		return sum > 0;
	};

	// 启动观察
	const startObserving = () => {
		// 先检查播放条件
		if (el.paused || el.muted) {
			corsLog.waiting();
			// 等待播放/取消静音后再开始
			const onReady = () => {
				el.removeEventListener('play', onReady);
				el.removeEventListener('volumechange', onReady);
				if (settled) return;
				corsLog.resumed();
				startObserving();
			};
			el.addEventListener('play', onReady, { once: true });
			el.addEventListener('volumechange', onReady, { once: true });
			return;
		}

		corsLog.log(`🔍 ${hostname}: 开始观察 (${observeTimeout / 1000}秒)`);

		// 定时检测
		observeTimer = setInterval(() => {
			if (settled) { cleanup(); return; }
			if (el.paused || el.muted) return; // 暂停/静音时跳过

			if (hasAudioData()) {
				// 🔴 关键检查：只有主视频的结果才被采信
				if (!isMainVideo(el)) {
					corsLog.log(`⚠️ ${hostname}: 检测到数据但非主视频，忽略`);
					return;
				}
				settled = true;
				cleanup();
				corsLog.safe();
				onResult(false);
			}
		}, observeInterval);

		// 超时判定
		timeoutTimer = setTimeout(() => {
			if (settled) { cleanup(); return; }
			cleanup();

			// 最终确认：检查是否有音频轨道
			if (!hasActiveAudio(el)) {
				corsLog.log(`⏸️ ${hostname}: 超时但无音频轨道，保持 PENDING`);
				return;
			}

			settled = true;
			corsLog.log(`❌ ${hostname}: 观察超时，判定 RESTRICTED`);
			onResult(true);
		}, observeTimeout);
	};

	// 延迟启动
	setTimeout(startObserving, startDelay);
}

