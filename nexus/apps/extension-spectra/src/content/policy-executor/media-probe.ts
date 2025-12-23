/**
 * 策略执行器 - 媒体元素探测辅助
 * 
 * 职责：查找适合 CORS 探测的媒体元素
 */

/**
 * 查找适合 CORS 探测的媒体元素
 * 
 * 条件：非静音、正在播放、时长 >= 5s、未被探测过、非循环
 */
export function findProbeCandidate(): HTMLMediaElement | null {
	const elements = document.querySelectorAll('video, audio');

	for (const el of elements) {
		const media = el as HTMLMediaElement;

		// 跳过已探测/已绑定的元素
		if (media.dataset.vmProbed === 'true' || media.dataset.vmAttached === 'true') {
			continue;
		}

		// 条件检查：正在播放 + 非静音 + 有音量 + 时长足够
		const isPlaying = !media.paused && !media.ended;
		const hasAudio = !media.muted && media.volume > 0.05;
		const hasEnoughDuration = media.duration >= 5 || isNaN(media.duration);
		const isNotLoop = !media.loop;  // 排除循环预览视频

		if (isPlaying && hasAudio && hasEnoughDuration && isNotLoop) {
			return media;
		}
	}

	return null;
}
