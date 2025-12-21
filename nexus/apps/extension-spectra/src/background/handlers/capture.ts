/**
 * SPECTRA Background - Capture 处理器
 * 
 * 处理 Tab Capture 相关的消息
 */

import { router, captureStates, captureLocks } from '../state';
import { ensureOffscreen } from '../helpers';
import { swLog } from '../../shared/logger';
import { AudioMode } from '@nexus/audio-engine';

/**
 * 注册 Capture 相关的消息处理器
 */
export function registerCaptureHandlers(): void {
	// Capture 模式切换 (NEXUS 契约: CAPTURE_TOGGLE)
	router.on('CAPTURE_TOGGLE', async (req, sender) => {
		const tabId = req.tabId ?? sender.tab?.id;
		swLog.capture(`CAPTURE_TOGGLE received: enabled=${req.enabled}, tabId=${tabId}`);

		if (!tabId) {
			swLog.warn('CAPTURE_TOGGLE failed: No tab ID');
			return { status: 'error' as const, error: 'No tab ID' };
		}

		// 检查锁 (防止高频点击)
		if (captureLocks.get(tabId)) {
			swLog.debug(`CAPTURE_TOGGLE skipped: Tab ${tabId} is locked`);
			return { status: 'processing' as const };
		}

		captureLocks.set(tabId, true);

		try {
			if (req.enabled) {
				// 1. 如果已在 Capture 中，仅更新配置
				if (captureStates.get(tabId)) {
					swLog.capture(`Tab ${tabId} already capturing, syncing config to offscreen`);
					if (req.config) {
						chrome.runtime.sendMessage({
							target: 'offscreen',
							action: 'updateConfig',
							tabId,
							config: req.config
						}).catch(() => { });
					}
					return { status: 'processing' as const };
				}

				// 2. 启动新的 Capture
				await ensureOffscreen();

				const streamId = await new Promise<string>((resolve, reject) => {
					chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (sid) => {
						if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
						else if (!sid) reject(new Error('No Stream ID returned'));
						else resolve(sid);
					});
				});

				chrome.runtime.sendMessage({
					target: 'offscreen',
					action: 'start',
					tabId,
					streamId,
					config: req.config
				});

				captureStates.set(tabId, true);
				swLog.capture(`Tab ${tabId}: Capture started`);

				// 3. 广播状态变化 (使用 NEXUS 契约格式)
				const notifyPayload = { tabId, enabled: true };
				chrome.tabs.sendMessage(tabId, { action: 'CAPTURE_STATE_CHANGE', payload: notifyPayload }).catch(() => { });
				chrome.runtime.sendMessage({ action: 'CAPTURE_STATE_CHANGE', payload: notifyPayload }).catch(() => { });

			} else {
				// 停止 Capture
				swLog.capture(`Tab ${tabId}: Stopping capture...`);
				if (captureStates.get(tabId)) {
					chrome.runtime.sendMessage({ target: 'offscreen', action: 'stop', tabId });
					captureStates.set(tabId, false);
				}

				const notifyPayload = { tabId, enabled: false };
				chrome.tabs.sendMessage(tabId, { action: 'CAPTURE_STATE_CHANGE', payload: notifyPayload }).catch(() => { });
				chrome.runtime.sendMessage({ action: 'CAPTURE_STATE_CHANGE', payload: notifyPayload }).catch(() => { });
			}

			return { status: 'processing' as const };
		} catch (e) {
			const errorMsg = e instanceof Error ? e.message : (typeof e === 'object' ? JSON.stringify(e) : String(e));
			swLog.error(`Capture Toggle Failed (Tab ${tabId}):`, {
				msg: errorMsg,
				stack: e instanceof Error ? e.stack : undefined,
				raw: e
			});
			captureStates.set(tabId, false);
			return { status: 'error' as const, error: errorMsg };
		} finally {
			setTimeout(() => captureLocks.delete(tabId), 500);
		}
	});

	// 获取 Capture 状态 (NEXUS 契约: CAPTURE_GET_STATE)
	router.on('CAPTURE_GET_STATE', async (req, sender) => {
		const tabId = req.tabId ?? sender.tab?.id;
		if (!tabId) return false;
		return captureStates.get(tabId) ?? false;
	});

	// 🔴 直接更新 Offscreen 配置 (NEXUS 契约: CAPTURE_UPDATE_CONFIG)
	// 用于 Popup 在 Capture 模式下直接同步配置到 Offscreen，避免中间层延迟
	router.on('CAPTURE_UPDATE_CONFIG', async (req, sender) => {
		const tabId = req.tabId;
		if (!tabId) return;

		// 只有已激活 Capture 的标签才处理
		if (!captureStates.get(tabId)) {
			swLog.debug(`CAPTURE_UPDATE_CONFIG ignored: Tab ${tabId} not capturing`);
			return;
		}

		swLog.debug(`CAPTURE_UPDATE_CONFIG: Tab ${tabId}, vol=${req.config.volume}`);
		chrome.runtime.sendMessage({
			target: 'offscreen',
			action: 'updateConfig',
			tabId,
			config: req.config
		}).catch(() => { });
	});
}

/**
 * 处理 Capture 切换 (内部清理用)
 */
export function handleCaptureToggle(tabId: number, enabled: boolean): void {
	if (!enabled && captureStates.get(tabId)) {
		chrome.runtime.sendMessage({ target: 'offscreen', action: 'stop', tabId });
		captureStates.set(tabId, false);
		const notifyPayload = { tabId, enabled: false };
		chrome.tabs.sendMessage(tabId, { action: 'CAPTURE_STATE_CHANGE', payload: notifyPayload }).catch(() => { });
	}
}
