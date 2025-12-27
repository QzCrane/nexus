/**
 * SPECTRA Background - 角标处理器
 * 
 * 处理扩展图标角标相关的消息
 * 
 * 角标显示规则（v3）：
 * - 仅当用户"明确使用了插件增强功能"时才显示角标
 * - userInteracted 由 content script 判断并传入
 * - 一旦显示角标，该标签页永久显示（sticky）
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

		const { volume, muted, isCapture, userInteracted } = req;

		// 🔴 v3 规则：未使用增强功能时不显示角标
		// userInteracted 由 content script 的 hasEnhancedUsage() 判断后设置
		if (!userInteracted) {
			badgeState.delete(tabId);
			try {
				await chrome.action.setBadgeText({ tabId, text: '' });
			} catch { }
			return;
		}

		// 计算角标文字
		let badgeText = '';
		let badgeColor: string = isCapture ? BADGE_COLORS.CAPTURE : BADGE_COLORS.NATIVE;

		if (muted || volume === 0) {
			badgeText = 'M';
			badgeColor = BADGE_COLORS.MUTED;
		} else {
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
