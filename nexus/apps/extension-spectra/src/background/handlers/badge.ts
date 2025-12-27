/**
 * SPECTRA Background - 角标处理器
 * 
 * 处理扩展图标角标相关的消息
 * 
 * 角标显示规则（v2）：
 * - 仅当配置处于"默认原生状态"时隐藏角标：
 *   1. 音量 == 100%
 *   2. 非静音
 *   3. 非捕获模式
 * - 其他所有情况都显示角标（包括从预设加载的配置）
 */

import { router, badgeState, BADGE_COLORS } from '../state';
import { isTabExists } from '../helpers';

/**
 * 判断是否处于默认原生状态（不需要显示角标）
 */
function isDefaultNativeState(volume: number, muted: boolean, isCapture: boolean): boolean {
	return volume === 100 && !muted && !isCapture;
}

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

		// 🔴 新规则：仅在默认原生状态时隐藏角标
		// 即使用户未交互，只要配置不是默认值也要显示角标（如从预设加载）
		if (isDefaultNativeState(volume, muted, isCapture)) {
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
