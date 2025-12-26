/**
 * SPECTRA Background - 音频处理器
 * 
 * 处理音频配置相关的消息
 */

import { router, storage, captureStates } from '../state';
import { swLog } from '../../shared/logger';

/**
 * 注册音频相关的消息处理器
 */
export function registerAudioHandlers(): void {
	// 获取音频状态 (NEXUS 契约: AUDIO_GET_STATUS)
	router.on('AUDIO_GET_STATUS', async (_, sender) => {
		const tabId = sender.tab?.id;
		const url = sender.tab?.url || '';

		let domain = '';
		try {
			domain = new URL(url).hostname;
		} catch {
			// 如果 URL 无效，通常发生在 chrome:// 等页面
		}

		const config = await storage.getAudioConfig(domain);
		const isCapture = tabId ? (captureStates.get(tabId) ?? false) : false;

		// 严格遵循 NexusMessages['AUDIO_GET_STATUS']['res']
		return {
			config,
			hasAudio: true,    // 默认认为有，真正的状态会在 Content Script 返回
			isPlaying: false,  // 默认认为无，真正的状态会在 Content Script 返回
			mode: isCapture ? 'CAPTURE' : 'NATIVE_WEBAUDIO',
			userInteracted: false
		};
	});

	// 更新音频配置 (NEXUS 契约: AUDIO_SET_CONFIG)
	router.on('AUDIO_SET_CONFIG', async (req, sender) => {
		const url = sender.tab?.url || '';
		let domain = '';
		try {
			domain = new URL(url).hostname;
		} catch { }

		if (domain && req.config) {
			// 🔴 关键修复：清除临时字段，防止污染存储
			const cleanConfig = { ...req.config };
			delete (cleanConfig as any).toggleMute;
			delete (cleanConfig as any).volumeDelta;

			await storage.setAudioConfig(domain, cleanConfig);
			swLog.debug(`[SW] Saved audio config for ${domain}`);
		}
		return { success: true };
	});
}
