/**
 * SPECTRA Background - 角标处理器
 * 
 * 处理扩展图标角标相关的消息
 */

import { router, badgeState, BADGE_COLORS } from '../state';
import { isTabExists } from '../helpers';

/**
 * 注册角标相关的消息处理器
 */
export function registerBadgeHandlers(): void {
	// 更新角标 - 完整实现
	router.on('BADGE_UPDATE', async (req, sender) => {
		const tabId = req.tabId ?? sender.tab?.id;
		if (!tabId) return;

		// 先验证标签页是否存在，防止操作已关闭的标签页
		if (!await isTabExists(tabId)) {
			badgeState.delete(tabId);
			return;
		}

		const { volume, muted, isCapture } = req;

		// 🔴 新增：默认配置（音量100%，未静音，非 Capture）时不显示角标
		const isDefaultConfig = volume === 100 && !muted && !isCapture;
		if (isDefaultConfig) {
			badgeState.delete(tabId);
			try {
				await chrome.action.setBadgeText({ tabId, text: '' });
			} catch {
				// 静默处理
			}
			return;
		}

		// 计算角标文字
		let badgeText = '';
		let badgeColor: string = isCapture ? BADGE_COLORS.CAPTURE : BADGE_COLORS.NATIVE;

		if (muted || volume === 0) {
			badgeText = 'M';
			badgeColor = BADGE_COLORS.MUTED;
		} else {
			// 显示音量数字
			badgeText = volume.toString();
		}

		// 保存状态
		badgeState.set(tabId, { volume, muted, isCapture, text: badgeText });

		// 设置角标（添加错误处理防止竞态条件）
		try {
			await chrome.action.setBadgeText({ tabId, text: badgeText });
			await chrome.action.setBadgeBackgroundColor({ tabId, color: badgeColor });
			await chrome.action.setBadgeTextColor({ tabId, color: BADGE_COLORS.WHITE });
		} catch {
			// 标签页可能在设置过程中被关闭，忽略错误
			badgeState.delete(tabId);
		}
	});

	// 清除角标 - 完整实现
	router.on('BADGE_CLEAR', async (req, sender) => {
		const tabId = req.tabId ?? sender.tab?.id;
		if (!tabId) return;

		// 清除状态
		badgeState.delete(tabId);

		// 添加错误处理，防止标签页不存在时抛出错误
		chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {
			// 静默处理
		});
	});
}
