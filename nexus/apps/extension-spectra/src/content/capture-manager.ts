/**
 * SPECTRA Content Script - Capture 模式管理
 * 
 * 负责与 Background 通信管理 Tab Capture 状态
 */

import type { NexusMessenger, AudioConfig } from '@nexus/kernel';
import { Actions } from '@nexus/contracts';
import { safeSend, isExtensionContextValid } from './context-guard';
import { logger } from '../shared/logger';

const log = logger.content;

/**
 * 创建 Capture 管理器
 */
export function createCaptureManager(messenger: NexusMessenger) {
	/** Capture 是否活跃 */
	let isCaptureActive = false;
	/** 是否正在请求切换 */
	let isPending = false;

	return {
		/** 获取当前 Capture 状态 */
		isActive(): boolean {
			return isCaptureActive;
		},

		/** 设置 Capture 状态 (由消息回调调用) */
		setActive(active: boolean): void {
			isCaptureActive = active;
			isPending = false;
		},

		/** 是否正在请求中 */
		isPending(): boolean {
			return isPending;
		},

		/** 请求切换 Capture 模式 */
		request(enabled: boolean, config: AudioConfig): void {
			if (isPending) {
				log.debug('Capture request skipped: pending');
				return;
			}
			if (!isExtensionContextValid()) {
				log.debug('Capture request skipped: context invalid');
				return;
			}

			isPending = true;
			log.capture(`Requesting Capture: ${enabled ? 'ON' : 'OFF'}`);

			safeSend(() => messenger.send('CAPTURE_TOGGLE', { enabled, config }))
				.then((response) => {
					log.capture(`Capture response:`, response);
					isCaptureActive = enabled;
				})
				.catch((e) => {
					log.error('Capture request failed:', e);
				})
				.finally(() => {
					setTimeout(() => {
						isPending = false;
					}, 500);
				});
		},

		/** 处理消息回调 */
		handleMessage(message: { action?: string; payload?: { enabled?: boolean }; enabled?: boolean }): boolean {
			if (message.action === Actions.CAPTURE_STATE_CHANGE) {
				const enabled = message.payload?.enabled ?? message.enabled ?? false;
				log.capture(`State change received: ${enabled ? 'ON' : 'OFF'}`);
				isCaptureActive = enabled;
				isPending = false;
				return true;
			}
			return false;
		},

		/** 同步配置到已激活的 Capture (用于滚轮/快捷键调音量) */
		syncConfig(config: AudioConfig): void {
			if (!isCaptureActive) return;
			if (!isExtensionContextValid()) return;

			// 发送 CAPTURE_TOGGLE 带 enabled=true 会触发 Background 的配置同步逻辑
			safeSend(() => messenger.send('CAPTURE_TOGGLE', { enabled: true, config })).catch(() => { });
		},
	};
}

export type CaptureManager = ReturnType<typeof createCaptureManager>;
