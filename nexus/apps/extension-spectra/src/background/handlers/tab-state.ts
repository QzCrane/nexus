/**
 * SPECTRA Background - Tab 状态处理器
 * 
 * 处理标签页音频状态上报和查询
 */

import { router, tabAudioStates, captureStates, TAB_VISIBLE_THRESHOLD_MS } from '../state';
import { swLog } from '../../shared/logger';

/**
 * 注册 Tab 状态相关的消息处理器
 */
export function registerTabStateHandlers(): void {
	// Content Script 上报媒体元素状态
	router.on('TAB_REPORT_MEDIA', async (req, sender) => {
		const tabId = sender.tab?.id;
		if (!tabId) return;

		const now = Date.now();
		const existing = tabAudioStates.get(tabId) ?? {
			hasMediaElement: false,
			lastAudibleTime: 0,
			lastActivatedTime: now,
			userManuallyActivated: false, // Content Script 上报不算主动激活
		};

		tabAudioStates.set(tabId, {
			...existing,
			hasMediaElement: req.hasMediaElement,
		});

		swLog.debug(`[SPECTRA] Tab ${tabId} reported media: ${req.hasMediaElement}`);
	});

	// Popup 查询应该显示的标签页列表
	router.on('TAB_GET_VISIBLE_TABS', async () => {
		const now = Date.now();
		const visibleTabs: number[] = [];

		for (const [tabId, state] of tabAudioStates.entries()) {
			// 🔴 关键：必须是当前 session 中用户主动激活过的标签
			if (!state.userManuallyActivated) continue;

			// 检查是否应该显示这个标签页
			const isCaptureActive = captureStates.get(tabId) === true;
			const hasMedia = state.hasMediaElement;
			const isRecentlyAudible = now - state.lastAudibleTime < TAB_VISIBLE_THRESHOLD_MS;

			// 符合条件：(有媒体 或 正在 Capture 或 60秒内有声) 且 主动激活过
			if (hasMedia || isCaptureActive || isRecentlyAudible) {
				visibleTabs.push(tabId);
			}
		}

		swLog.debug(`[SPECTRA] Visible tabs: ${visibleTabs.join(', ')}`);
		return { tabs: visibleTabs };
	});
}
