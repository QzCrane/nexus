/**
 * SPECTRA Background - Capture 处理器
 */

import { router, captureStates, captureLocks } from '../state';
import { ensureOffscreen } from '../helpers';
import { swLog } from '../../shared/logger';
import { Actions, OffscreenActions } from '@nexus/contracts';

/**
 * 注册 Capture 相关的消息处理器
 */
export function registerCaptureHandlers(): void {
	router.on('CAPTURE_TOGGLE', async (req, sender) => {
		const tabId = req.tabId ?? sender.tab?.id;
		swLog.capture(`CAPTURE_TOGGLE received: enabled=${req.enabled}, tabId=${tabId}`);

		if (!tabId) {
			swLog.warn('CAPTURE_TOGGLE failed: No tab ID');
			return { status: 'error' as const, error: 'No tab ID' };
		}

		if (captureLocks.get(tabId)) {
			swLog.debug(`CAPTURE_TOGGLE skipped: Tab ${tabId} is locked`);
			return { status: 'processing' as const };
		}

		captureLocks.set(tabId, true);

		try {
			if (req.enabled) {
				if (captureStates.get(tabId)) {
					swLog.capture(`Tab ${tabId} already capturing, syncing config`);
					if (req.config) {
						chrome.runtime.sendMessage({
							target: 'offscreen',
							action: OffscreenActions.OFFSCREEN_UPDATE_CONFIG,
							tabId,
							config: req.config
						}).catch(() => { });
					}
					return { status: 'processing' as const };
				}

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
					action: OffscreenActions.OFFSCREEN_START,
					tabId,
					streamId,
					config: req.config
				});

				captureStates.set(tabId, true);
				swLog.capture(`Tab ${tabId}: Capture started`);

				const notifyPayload = { tabId, enabled: true };
				chrome.tabs.sendMessage(tabId, { action: Actions.CAPTURE_STATE_CHANGE, payload: notifyPayload }).catch(() => { });
				chrome.runtime.sendMessage({ action: Actions.CAPTURE_STATE_CHANGE, payload: notifyPayload }).catch(() => { });

			} else {
				swLog.capture(`Tab ${tabId}: Stopping capture...`);
				if (captureStates.get(tabId)) {
					chrome.runtime.sendMessage({ target: 'offscreen', action: OffscreenActions.OFFSCREEN_STOP, tabId });
					captureStates.set(tabId, false);
				}

				const notifyPayload = { tabId, enabled: false };
				chrome.tabs.sendMessage(tabId, { action: Actions.CAPTURE_STATE_CHANGE, payload: notifyPayload }).catch(() => { });
				chrome.runtime.sendMessage({ action: Actions.CAPTURE_STATE_CHANGE, payload: notifyPayload }).catch(() => { });
			}

			return { status: 'processing' as const };
		} catch (e) {
			const errorMsg = e instanceof Error ? e.message : String(e);
			swLog.error(`Capture Toggle Failed (Tab ${tabId}):`, e);
			captureStates.set(tabId, false);
			return { status: 'error' as const, error: errorMsg };
		} finally {
			setTimeout(() => captureLocks.delete(tabId), 500);
		}
	});

	router.on('CAPTURE_GET_STATE', async (req, sender) => {
		const tabId = req.tabId ?? sender.tab?.id;
		if (!tabId) return false;
		return captureStates.get(tabId) ?? false;
	});

	router.on('CAPTURE_UPDATE_CONFIG', async (req, sender) => {
		// 🔴 支持从 sender.tab.id 获取 tabId，使 Content Script 可以发送配置更新
		const tabId = req.tabId ?? sender.tab?.id;
		if (!tabId || !captureStates.get(tabId)) return;

		swLog.debug(`CAPTURE_UPDATE_CONFIG: Tab ${tabId}, vol=${req.config.volume}`);
		chrome.runtime.sendMessage({
			target: 'offscreen',
			action: OffscreenActions.OFFSCREEN_UPDATE_CONFIG,
			tabId,
			config: req.config
		}).catch(() => { });
	});
}

/** 处理 Capture 切换 */
export function handleCaptureToggle(tabId: number, enabled: boolean): void {
	if (!enabled && captureStates.get(tabId)) {
		chrome.runtime.sendMessage({ target: 'offscreen', action: OffscreenActions.OFFSCREEN_STOP, tabId });
		captureStates.set(tabId, false);
		const notifyPayload = { tabId, enabled: false };
		chrome.tabs.sendMessage(tabId, { action: Actions.CAPTURE_STATE_CHANGE, payload: notifyPayload }).catch(() => { });
	}
}
