// goal: provides a centralized registry to store and retrieve tab-specific audio configurations and their respective update handlers

import type { AudioConfig } from '@nexus/kernel';

export interface CardRegistration {
	update: (changes: Partial<AudioConfig>) => void;
	flush?: () => Promise<void>;
	getConfig: () => AudioConfig;
}

const cardRegistry = new Map<number, CardRegistration>();

// eff: registers a tab's current state and its update function, enabling settings in the side panel to trigger re-renders in the main card
export function registerCard(
	tabId: number,
	update: (changes: Partial<AudioConfig>) => void,
	getConfig: () => AudioConfig,
	flush?: () => Promise<void>,
): () => void {
	const registration = { update, getConfig, flush };
	cardRegistry.set(tabId, registration);
	return () => {
		if (cardRegistry.get(tabId) === registration) cardRegistry.delete(tabId);
	};
}

export function getCardRegistration(tabId: number): CardRegistration | undefined {
	return cardRegistry.get(tabId);
}
