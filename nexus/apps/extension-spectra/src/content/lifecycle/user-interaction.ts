/**
 * Content Script - 用户交互处理
 * 
 * 职责：
 * - 监听用户手势事件（click, keydown 等）
 * - 用于解锁 AudioContext（Chrome 自动播放策略）
 * - Popup 连接状态追踪
 */

import { AudioMode, WebAudioController } from '@nexus/audio-engine';
import { logger } from '../../shared/logger';
import type { PolicyExecutorState } from '../types';
import type { PolicyExecutor } from '../policy-executor';

const log = logger.content;

/**
 * 设置用户手势监听，用于解锁 AudioContext
 * 
 * @param state 状态对象
 * @param audioController WebAudio 控制器
 * @param policyExecutor 策略执行器
 */
export function setupUserGestureListeners(
	state: PolicyExecutorState,
	audioController: WebAudioController,
	policyExecutor: PolicyExecutor
): void {
	const handleUserGestureUnlock = () => {
		if (state.activeMode === AudioMode.NATIVE_WEBAUDIO && !audioController.isReady()) {
			log.debug('User gesture detected, retrying WebAudio init.');
			policyExecutor.applyState();
		}
	};

	const interactionEvents = ['click', 'keydown', 'touchstart', 'mousedown'];
	interactionEvents.forEach(event => {
		document.addEventListener(event, handleUserGestureUnlock, { once: true, passive: true });
	});
}

/**
 * 设置 Popup 连接监听
 * 
 * 用于追踪 Popup 是否打开，以决定是否显示 OSD
 * 
 * @param state 状态对象
 */
export function setupPopupConnectionListener(state: PolicyExecutorState): void {
	chrome.runtime.onConnect.addListener((port) => {
		if (port.name === 'popup-connection') {
			state.isPopupOpen = true;
			port.onDisconnect.addListener(() => {
				state.isPopupOpen = false;
			});
		}
	});
}
