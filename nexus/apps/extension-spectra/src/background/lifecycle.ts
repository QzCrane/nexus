/**
 * SPECTRA Background - Tab 生命周期处理
 * 
 * 处理标签页更新、激活和关闭事件
 */

import { captureStates, badgeState, tabAudioStates, cleanupTabState } from './state';
import { handleCaptureToggle } from './handlers/capture';
import { swLog } from '../shared/logger';

/**
 * 设置 Tab 生命周期监听器
 */
export function setupLifecycleListeners(): void {
	// 标签页激活事件 - 更新 lastActivatedTime
	chrome.tabs.onActivated.addListener((activeInfo) => {
		const now = Date.now();
		const existing = tabAudioStates.get(activeInfo.tabId);

		if (existing) {
			tabAudioStates.set(activeInfo.tabId, {
				...existing,
				lastActivatedTime: now,
			});
		} else {
			// 首次激活，创建初始状态
			tabAudioStates.set(activeInfo.tabId, {
				hasMediaElement: false,
				lastAudibleTime: 0,
				lastActivatedTime: now,
			});
		}
	});

	// 标签页更新事件 - 处理多种变化
	chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
		// audible 状态变化 - 更新 lastAudibleTime
		if (changeInfo.audible !== undefined) {
			const now = Date.now();
			const existing = tabAudioStates.get(tabId);

			if (changeInfo.audible && existing) {
				tabAudioStates.set(tabId, {
					...existing,
					lastAudibleTime: now,
				});
			}
		}

		// 页面重载 - 清理角标和 Capture
		if (changeInfo.status === 'loading' && changeInfo.url) {
			// 页面重新加载时清除角标
			badgeState.delete(tabId);
			chrome.action.setBadgeText({ tabId, text: '' }).catch(() => { });

			// 如果有 Capture 活动，强制停止
			if (captureStates.get(tabId)) {
				swLog.capture(`Tab ${tabId} reloading, force stopping capture.`);
				handleCaptureToggle(tabId, false);
			}
		}
	});

	// 标签页关闭事件 - 清理所有状态
	chrome.tabs.onRemoved.addListener((tabId) => {
		cleanupTabState(tabId);

		// 如果有 Capture 活动，停止
		if (captureStates.get(tabId)) {
			handleCaptureToggle(tabId, false);
		}
	});
}

