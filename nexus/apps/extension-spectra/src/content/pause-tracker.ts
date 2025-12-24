/**
 * SPECTRA Content Script - 媒体暂停追踪
 * 
 * 追踪媒体暂停时间戳，用于暂停保留时间功能
 */

/** 暂停时间戳 (ms)，null 表示正在播放 */
let pausedAt: number | null = null;

/** 已绑定暂停追踪的元素 */
const pauseTracked = new WeakSet<HTMLMediaElement>();

/**
 * 获取暂停时间戳
 */
export function getPausedAt(): number | null {
	return pausedAt;
}

/**
 * 更新暂停时间戳
 * @param hasPlaying 是否有正在播放的媒体
 * @param hasElements 是否有媒体元素
 */
export function updatePausedAt(hasPlaying: boolean, hasElements: boolean): void {
	if (hasPlaying) {
		pausedAt = null;
	} else if (pausedAt === null && hasElements) {
		pausedAt = Date.now();
	}
}

/**
 * 检查是否需要为媒体元素设置暂停追踪
 */
export function needsTracking(media: HTMLMediaElement): boolean {
	return !pauseTracked.has(media);
}

/**
 * 标记媒体元素已设置追踪
 */
export function markTracked(media: HTMLMediaElement): void {
	pauseTracked.add(media);
}

/**
 * 设置媒体暂停追踪监听器
 */
export function setupPauseTracking(media: HTMLMediaElement, isAnyPlayingFn: () => boolean): void {
	media.addEventListener('pause', () => {
		if (!isAnyPlayingFn()) {
			pausedAt = Date.now();
		}
	});

	media.addEventListener('play', () => {
		pausedAt = null;
	});

	markTracked(media);
}
