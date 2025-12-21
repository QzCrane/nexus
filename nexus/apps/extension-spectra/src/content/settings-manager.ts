/**
 * SPECTRA Content Script - 全局设置管理
 * 
 * 负责管理全局设置状态，包括从 Background 获取和监听更新
 */

import type { NexusMessenger } from '@nexus/kernel';
import { safeSend, isExtensionContextValid } from './context-guard';

/** 全局设置接口 */
export interface ContentGlobalSettings {
	osdEnabled: boolean;
	visualizerEnabled: boolean;
	lang: string;
}

/** 默认全局设置 */
export const DEFAULT_CONTENT_SETTINGS: ContentGlobalSettings = {
	osdEnabled: true,
	visualizerEnabled: true,
	lang: 'en-US',
};

/**
 * 创建全局设置管理器
 */
export function createSettingsManager(messenger: NexusMessenger) {
	// 设置状态
	let settings: ContentGlobalSettings = { ...DEFAULT_CONTENT_SETTINGS };

	return {
		/** 获取当前设置 */
		get(): ContentGlobalSettings {
			return settings;
		},

		/** 更新设置 */
		update(partial: Partial<ContentGlobalSettings>): void {
			settings = { ...settings, ...partial };
		},

		/** 从 Background 加载设置 */
		async load(): Promise<void> {
			if (!isExtensionContextValid()) return;

			const loaded = await safeSend(() => messenger.send('SETTINGS_GET'));
			if (loaded) {
				settings = { ...settings, ...loaded };
			}
		},

		/** 设置消息监听器 (在 onMessage 回调中调用) */
		handleMessage(message: { action?: string; settings?: Partial<ContentGlobalSettings> }): boolean {
			if (message.action === 'GLOBAL_SETTINGS_UPDATE' || message.action === 'globalSettingsUpdate') {
				if (message.settings) {
					settings = { ...settings, ...message.settings };
				}
				return true;
			}
			return false;
		},
	};
}

export type SettingsManager = ReturnType<typeof createSettingsManager>;
