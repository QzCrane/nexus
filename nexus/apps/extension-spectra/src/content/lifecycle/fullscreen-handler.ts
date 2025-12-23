/**
 * Content Script - 全屏处理器
 * 
 * 简化方案：
 * - SPECTRA_PAUSE_FOR_FULLSCREEN: requestFullscreen 被调用，关闭 Capture
 * - SPECTRA_FULLSCREEN_ENTERED: 进入全屏成功，延迟恢复 Capture
 */

import { AudioMode } from '@nexus/audio-engine';
import { logger } from '../../shared/logger';
import type { PolicyExecutorState } from '../types';
import type { CaptureManager } from '../capture-manager';

const log = logger.content;

interface FullscreenHandlerConfig {
	restoreDelayMs: number;
	enabled: boolean;
}

const DEFAULT_CONFIG: FullscreenHandlerConfig = {
	restoreDelayMs: 500,  // 进入全屏后延迟恢复
	enabled: true,
};

export function setupFullscreenHandler(
	state: PolicyExecutorState,
	_policyExecutor: unknown,
	captureManager: CaptureManager,
	config: Partial<FullscreenHandlerConfig> = {}
): () => void {
	const cfg = { ...DEFAULT_CONFIG, ...config };
	if (!cfg.enabled) return () => { };

	let savedVolume: number | null = null;
	let restoreTimer: ReturnType<typeof setTimeout> | null = null;
	let pausedForFullscreen = false;
	let pauseCount = 0;  // 防止重复恢复

	/** 全屏请求时关闭 Capture */
	function handlePause(): void {
		const isCapture = captureManager.isActive() || state.activeMode === AudioMode.CAPTURE;
		if (!isCapture) return;

		pauseCount++;
		const currentPause = pauseCount;

		if (restoreTimer) { clearTimeout(restoreTimer); restoreTimer = null; }

		if (!pausedForFullscreen) {
			savedVolume = state.config.volume;
			pausedForFullscreen = true;
			log.info(`[FS] 全屏请求，暂存音量 ${savedVolume}%，关闭劫持`);
			captureManager.request(false, state.config);
		}

		// 安全网：如果 3 秒内没有进入全屏，恢复
		restoreTimer = setTimeout(() => {
			if (pauseCount !== currentPause) return;  // 已被新请求覆盖
			restoreTimer = null;
			if (pausedForFullscreen) {
				log.info('[FS] 超时未进入全屏，恢复劫持');
				restoreCapture();
			}
		}, 3000);
	}

	/** 进入全屏成功，延迟恢复 */
	function handleEntered(): void {
		if (!pausedForFullscreen) return;

		if (restoreTimer) { clearTimeout(restoreTimer); restoreTimer = null; }

		log.info('[FS] 进入全屏成功，延迟恢复');

		restoreTimer = setTimeout(() => {
			restoreTimer = null;
			restoreCapture();
		}, cfg.restoreDelayMs);
	}

	/** 恢复 Capture */
	function restoreCapture(): void {
		if (!pausedForFullscreen) return;
		pausedForFullscreen = false;

		if (!state.config.enabled) {
			savedVolume = null;
			return;
		}

		const vol = savedVolume ?? state.config.volume;
		log.info(`[FS] 恢复劫持，音量 ${vol}%`);
		state.userHasInteracted = true;
		captureManager.request(true, { ...state.config, volume: vol });
		savedVolume = null;
	}

	function handleMessage(event: MessageEvent): void {
		if (event.source !== window) return;
		switch (event.data?.type) {
			case 'SPECTRA_PAUSE_FOR_FULLSCREEN': handlePause(); break;
			case 'SPECTRA_FULLSCREEN_ENTERED': handleEntered(); break;
		}
	}

	window.addEventListener('message', handleMessage);
	log.debug('[FS] 全屏处理器已启用');

	return () => {
		window.removeEventListener('message', handleMessage);
		if (restoreTimer) clearTimeout(restoreTimer);
	};
}
