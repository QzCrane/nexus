/**
 * SPECTRA Background - 状态管理
 * 
 * 集中管理所有 Background Script 的状态
 */

import { createRouter, StorageRepository } from '@nexus/kernel';
import { UIColors } from '@nexus/audio-engine';

// ============================================
// 类型定义
// ============================================

/** 角标状态信息 */
export interface BadgeInfo {
	volume: number;
	muted: boolean;
	isCapture: boolean;
	text: string;
}

/** 颜色常量 (从 @nexus/audio-engine 统一导入) */
export const BADGE_COLORS = UIColors;


// ============================================
// 单例实例
// ============================================

/** 消息路由器 */
export const router = createRouter();

/** 存储仓库 */
export const storage = new StorageRepository();

// ============================================
// 状态映射表
// ============================================

/** Capture 状态映射 (tabId -> isActive) */
export const captureStates = new Map<number, boolean>();

/** Capture 互斥锁 (tabId -> isLocked)，防止同一标签页重复请求 */
export const captureLocks = new Map<number, boolean>();

/** 角标状态映射 (tabId -> BadgeInfo)，用于跟踪每个标签页的角标 */
export const badgeState = new Map<number, BadgeInfo>();

/** Tab 音频状态信息 (用于 UI 显示规则) */
export interface TabAudioState {
	/** 页面是否有 audio/video 元素 */
	hasMediaElement: boolean;
	/** 最后发声时间戳 (ms) */
	lastAudibleTime: number;
	/** 用户最后切换到该标签页的时间戳 (ms) */
	lastActivatedTime: number;
	/** 用户是否在当前 session 中主动激活过 (区分扩展重载前的旧状态) */
	userManuallyActivated: boolean;
}

/** 当前 Service Worker 会话 ID (每次重载递增) */
export const currentSessionId = Date.now();

/** Tab 音频状态映射 (tabId -> TabAudioState) */
export const tabAudioStates = new Map<number, TabAudioState>();

/** 60 秒阈值常量 (用于判断后台标签页是否应该显示) */
export const TAB_VISIBLE_THRESHOLD_MS = 60 * 1000;

// ============================================
// 状态操作函数
// ============================================

/**
 * 清理指定标签页的所有状态
 * @param tabId - 标签页 ID
 */
export function cleanupTabState(tabId: number): void {
	captureStates.delete(tabId);
	captureLocks.delete(tabId);
	badgeState.delete(tabId);
	tabAudioStates.delete(tabId);
}
