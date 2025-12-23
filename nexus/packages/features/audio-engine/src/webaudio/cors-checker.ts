/**
 * CORS 数据检查器 (v3.7)
 * 
 * 通过读取 AnalyserNode 数据判断 CORS 状态
 * CORS 限制会导致数据全零
 * 
 * v3.7: 修复暂停/静音时检测中断问题，改为监听 play 事件继续检测
 */

import { corsLogger as corsLog } from '@nexus/kernel';

export type CorsCheckCallback = (restricted: boolean) => void;

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

		// 检查是否应该继续
		const canCheck = !el.paused && !el.muted && el.volume > 0;

		if (canCheck) {
			if (checkCount >= maxChecks) {
				// 多次全零 = RESTRICTED (CORS 限制)
				settled = true;
				corsLog.restricted(maxChecks);
				onResult(true);
			} else {
				// 条件满足但无数据，继续检查
				setTimeout(check, checkInterval);
			}
		} else {
			// v3.7: 视频暂停/静音，监听 play 事件后继续检测
			corsLog.waiting();
			const onPlay = () => {
				el.removeEventListener('play', onPlay);
				corsLog.resumed();
				checkCount = 0; // 重置计数
				setTimeout(check, 100); // 减少延迟
			};
			el.addEventListener('play', onPlay, { once: true });
		}
	};

	// 首次检查延迟 100ms
	setTimeout(check, 100);
}


