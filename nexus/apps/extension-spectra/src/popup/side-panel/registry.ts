/**
 * SPECTRA Popup - 侧边面板卡片注册
 * 职责：管理卡片配置和更新函数的注册
 */

import type { AudioConfig } from '@nexus/kernel';

/** 卡片注册信息 */
export interface CardRegistration {
	config: AudioConfig;
	update: (changes: Partial<AudioConfig>) => void;
	getConfig: () => AudioConfig;
}

/** 已注册的卡片 (tabId -> registration) */
const cardRegistry = new Map<number, CardRegistration>();

/**
 * 注册卡片配置和更新函数
 */
export function registerCard(
	tabId: number,
	config: AudioConfig,
	update: (changes: Partial<AudioConfig>) => void,
	getConfig: () => AudioConfig
): void {
	cardRegistry.set(tabId, { config, update, getConfig });
}

/**
 * 获取卡片注册信息
 */
export function getCardRegistration(tabId: number): CardRegistration | undefined {
	return cardRegistry.get(tabId);
}

/**
 * 更新已注册卡片的配置
 */
export function updateCardConfig(tabId: number, config: AudioConfig): void {
	const reg = cardRegistry.get(tabId);
	if (reg) {
		reg.config = config;
	}
}

/**
 * 获取已注册卡片的配置 (供侧边面板同步用)
 */
export function getRegisteredConfig(tabId: number): AudioConfig | undefined {
	return cardRegistry.get(tabId)?.config;
}
