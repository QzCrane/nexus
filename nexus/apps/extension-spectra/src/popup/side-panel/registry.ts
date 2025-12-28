/**
 * SPECTRA Popup - Side Panel Card Registry
 * Manage card config and update function registration.
 */

import type { AudioConfig } from '@nexus/kernel';

export interface CardRegistration {
	config: AudioConfig;
	update: (changes: Partial<AudioConfig>) => void;
	getConfig: () => AudioConfig;
}

/** Registered Cards (tabId -> registration) */
const cardRegistry = new Map<number, CardRegistration>();

export function registerCard(
	tabId: number,
	config: AudioConfig,
	update: (changes: Partial<AudioConfig>) => void,
	getConfig: () => AudioConfig
): void {
	cardRegistry.set(tabId, { config, update, getConfig });
}

export function getCardRegistration(tabId: number): CardRegistration | undefined {
	return cardRegistry.get(tabId);
}

export function updateCardConfig(tabId: number, config: AudioConfig): void {
	const reg = cardRegistry.get(tabId);
	if (reg) {
		reg.config = config;
	}
}

export function getRegisteredConfig(tabId: number): AudioConfig | undefined {
	return cardRegistry.get(tabId)?.config;
}
