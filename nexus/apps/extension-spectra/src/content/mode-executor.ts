/**
 * SPECTRA Content Script - 模式执行器
 * 
 * 负责根据当前模式执行具体的音频操作（DOM 控制或 WebAudio 控制）
 */

import { AudioMode } from '@nexus/audio-engine';
import type { AudioConfig } from '@nexus/kernel';
import type { PolicyExecutorDeps, PolicyExecutorState } from './types';
import { setDomVolume, isAnyMediaPlaying, releaseVolumeLock, enableVolumeLock } from './dom-volume';
import { logger } from '../shared/logger';

const log = logger.content;

/**
 * 检测用户手势
 */
export function hasUserGesture(state: PolicyExecutorState): boolean {
	if (state.userHasInteracted) return true;

	// 1. 检查是否有正在播放的媒体 (表示用户已点击播放)
	if (isAnyMediaPlaying()) return true;

	// 2. 检查浏览器激活状态
	const userActivation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
	if (userActivation?.hasBeenActive) return true;

	return false;
}

/**
 * 执行当前模式的音频处理
 */
export function executeMode(deps: PolicyExecutorDeps, state: PolicyExecutorState): void {
	const { audioController, captureManager } = deps;
	const mode = state.activeMode;
	const config = state.config;

	if (mode === AudioMode.CAPTURE) {
		// Capture 模式：优先由 Popup 触发，但如果 Content 有手势也可触发
		if (captureManager.isActive()) {
			// 释放音量锁，实际音量由 Offscreen 控制
			releaseVolumeLock();
			// 🔴 关键：必须同步配置到 Offscreen (否则滚轮/快捷键调音量不生效)
			captureManager.syncConfig(config);
		} else if (hasUserGesture(state)) {
			// 策略推荐 CAPTURE 且有手势 (来自 OSD 或快捷键)，主动请求背景劫持
			log.capture('Strategy suggests CAPTURE and gesture detected, requesting...');
			captureManager.request(true, config);
			// 暂时回退到 DOM 控制直到劫持成功
			fallbackToDom(config);
		} else {
			// Capture 未激活且无手势，回退到 DOM 控制
			fallbackToDom(config);
		}

	} else if (mode === AudioMode.NATIVE_LITE) {
		// 精简模式：仅 DOM 控制，启用音量锁
		const domVol = config.muted ? 0 : Math.min(1, config.volume / 100);
		enableVolumeLock(domVol, config.muted);

	} else if (mode === AudioMode.NATIVE_WEBAUDIO) {
		// WebAudio 模式 - 只在有用户手势时才初始化
		if (hasUserGesture(state)) {
			if (!audioController.isReady()) {
				// 尝试初始化。注意：即使 hasUserGesture 为真，如果不处在直接的手势回调中，
				// AudioContext.resume() 仍可能静默失败。这里的 initialize 内部已做静默处理。
				audioController.initialize().then((success) => {
					if (success) {
						// 释放音量锁，由 WebAudio GainNode 控制音量
						releaseVolumeLock();
						audioController.scanAndAttach();
						audioController.updateParams(config);
					} else {
						// 初始化失败，回退到 DOM 控制
						log.debug('WebAudio init failed -> fallback to DOM');
						fallbackToDom(config);
					}
				});
			} else {
				// 已就绪，释放音量锁并更新参数
				releaseVolumeLock();
				audioController.scanAndAttach();
				audioController.updateParams(config);
			}
		} else {
			// 没有用户手势，回退到 DOM 控制
			fallbackToDom(config);
		}
	}
}

/**
 * 回退到 DOM 控制 (当高级模式不可用时)
 * 
 * 如果音量 > 100%，会被钳制到 100%（DOM 不支持增益）
 */
function fallbackToDom(config: AudioConfig): void {
	const domVol = config.muted ? 0 : Math.min(1, config.volume / 100);
	enableVolumeLock(domVol, config.muted);
}
