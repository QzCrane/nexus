/**
 * CORS 数据检查器
 * 
 * 通过读取 AnalyserNode 数据判断 CORS 状态
 * CORS 限制会导致数据全零
 */

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
	const maxChecks = 5;
	const checkInterval = 200; // ms

	const check = () => {
		checkCount++;
		const data = new Uint8Array(analyser.frequencyBinCount);
		analyser.getByteFrequencyData(data);
		const hasData = data.some(v => v > 0);

		if (hasData) {
			// 有数据 = SAFE
			onResult(false);
		} else if (checkCount >= maxChecks) {
			// 多次全零 = RESTRICTED (CORS 限制)
			onResult(true);
		} else if (!el.paused && !el.muted && el.volume > 0) {
			// 条件满足但无数据，继续检查
			setTimeout(check, checkInterval);
		}
		// 如果视频暂停/静音，不判定，等待后续
	};

	// 首次检查延迟 300ms，让音频数据有时间填充
	setTimeout(check, 300);
}
