/**
 * 策略执行器 - 类型定义
 * 
 * 集中定义模块内部使用的类型，避免循环依赖
 */

import type { AudioConfig } from '@nexus/kernel';
import type { UrlInfo } from '@nexus/audio-engine';

/**
 * 策略执行器公共接口
 */
export interface PolicyExecutor {
	/** 应用当前策略状态 */
	applyState(): void;
	/** 更新角标 */
	updateBadge(): void;
	/** 统一配置更新接口 */
	updateConfig(changes: Partial<AudioConfig>, options?: { showOSD?: boolean; unMute?: boolean }): void;
	/** 检查是否有用户手势 */
	hasUserGesture(): boolean;
	/** 标记用户已交互 */
	markUserInteracted(): void;
	/** 获取当前音频模式 */
	getActiveMode(): string | null;
	/** 获取当前 URL 信息 */
	getUrlInfo(): UrlInfo;
	/** 触发 CORS 预检测 */
	probeCors(): void;
}

/**
 * CORS 检测状态
 */
export type CorsStatus = 'PENDING' | 'SAFE' | 'RESTRICTED';

/**
 * 内部状态对象（用于模块间共享）
 */
export interface InternalState {
	/** CORS 检测状态 */
	corsStatus: CorsStatus;
	/** 上一次角标更新的哈希值（用于去重） */
	lastBadgeHash: string;
	/** 上一次 UI 同步的哈希值（用于去重） */
	lastSyncHash: string;
}
