/**
 * CORS 数据检查器 (v3.9)
 * 
 * 通过读取 AnalyserNode 数据判断 CORS 状态
 * CORS 限制会导致数据全零
 * 
 * v3.9: 增强预览视频识别
 *   - 静音元素直接跳过 (无法产生音频数据)
 *   - 循环播放元素跳过 (大概率是预览/背景)
 *   - src 包含预览关键词时跳过
 *   - 短视频+低音量时跳过
 * v3.8: 修复B站浏览页误判问题
 *   - 添加音频轨道检查，避免静音预览视频被误判
 * v3.7: 修复暂停/静音时检测中断问题，改为监听 play 事件继续检测
 */

import { corsLogger as corsLog } from '@nexus/kernel';

export type CorsCheckCallback = (restricted: boolean) => void;

/**
 * 检查媒体元素是否有可用的音频
 * 
 * @returns true = 有音频轨道，可检测；false = 无音频，应跳过
 */
function hasActiveAudio(el: HTMLMediaElement): boolean {
	// 检查 1: 使用 audioTracks API (部分浏览器支持)
	const audioTracks = (el as HTMLVideoElement & { audioTracks?: { length: number } }).audioTracks;
	if (audioTracks && audioTracks.length === 0) {
		return false; // 明确无音频轨道
	}

	// 检查 2: 静音状态 = 无法检测 CORS (无论是否有音频)
	if (el.muted) {
		// 静音视频无法产生音频数据，不做结论
		return false;
	}

	// 检查 3: 循环播放 = 大概率是预览/背景视频
	if (el.loop) {
		return false;
	}

	// 检查 4: src 包含预览关键词
	const src = el.src || el.currentSrc || '';
	const previewKeywords = ['preview', 'thumb', 'poster', 'cover', 'banner'];
	if (previewKeywords.some(kw => src.toLowerCase().includes(kw))) {
		return false;
	}

	// 检查 5: 短视频 (<60s) 且音量很低 = 可能是预览
	if (el.duration < 60 && el.volume < 0.1) {
		return false;
	}

	// 检查 6: 视频元素检查 videoWidth (排除纯音频伪装)
	if (el instanceof HTMLVideoElement && el.videoWidth === 0 && el.videoHeight === 0) {
		return true; // 纯音频，应检测
	}

	// 默认假设有音频（保守策略）
	return true;
}

/**
 * 延迟检查 CORS 状态
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
	let checkCount = 0;
	const maxChecks = 3;        // 减少到 3 次
	const checkInterval = 80;   // 减少到 80ms
	let settled = false;
	const hostname = window.location.hostname;

	corsLog.start(hostname, el);

	const check = () => {
		if (settled) return; // 已结束，不再检测
		checkCount++;

		const data = new Uint8Array(analyser.frequencyBinCount);
		analyser.getByteFrequencyData(data);
		const sum = data.reduce((a, b) => a + b, 0);
		const hasData = sum > 0;

		corsLog.check(checkCount, maxChecks, sum, hasData);

		if (hasData) {
			// 有数据 = SAFE
			settled = true;
			corsLog.safe();
			onResult(false);
			return;
		}

		// 检查播放条件
		const isPlaying = !el.paused;
		const hasVolume = !el.muted && el.volume > 0;
		const canCheck = isPlaying && hasVolume;

		if (canCheck) {
			// v3.8: 在判定 RESTRICTED 前，检查是否真的有音频轨道
			if (checkCount >= maxChecks) {
				// 检查媒体是否有音频轨道
				if (!hasActiveAudio(el)) {
					// 无音频轨道的预览视频，不做结论
					corsLog.log(`⏸️ ${hostname}: 无音频轨道,跳过检测`);
					// 不调用 onResult，保持 PENDING，等待用户进入播放页
					return;
				}
				// 有音频轨道但全零 = RESTRICTED (CORS 限制)
				settled = true;
				corsLog.restricted(maxChecks);
				onResult(true);
			} else {
				// 条件满足但无数据，继续检查
				setTimeout(check, checkInterval);
			}
		} else {
			// v3.7: 视频暂停/静音，监听事件后继续检测
			corsLog.waiting();

			const tryResume = () => {
				el.removeEventListener('play', tryResume);
				el.removeEventListener('volumechange', tryResume);
				if (settled) return;
				corsLog.resumed();
				checkCount = 0; // 重置计数
				setTimeout(check, 150);
			};

			// 监听 play 和 volumechange 事件
			el.addEventListener('play', tryResume, { once: true });
			el.addEventListener('volumechange', tryResume, { once: true });
		}
	};

	// 首次检查延迟 150ms，等待媒体加载
	setTimeout(check, 150);
}


