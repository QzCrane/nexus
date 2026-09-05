import type { AudioConfig } from '@nexus/kernel';

export interface PresetApplyTarget {
	domain: string;
	apply: (config: Partial<AudioConfig>) => Promise<void> | void;
	readCurrent?: () => Partial<AudioConfig>;
}

type PresetApplyTargetProvider = (() => PresetApplyTarget | null) | null;

let provider: PresetApplyTargetProvider = null;
const targetChangeListeners = new Set<() => void>();

export function setPresetApplyTargetProvider(providerValue: PresetApplyTargetProvider): () => void {
	provider = providerValue;
	for (const listener of targetChangeListeners) listener();
	return () => {
		if (provider === providerValue) {
			provider = null;
			for (const listener of targetChangeListeners) listener();
		}
	};
}

export function getPresetApplyTarget(): PresetApplyTarget | null {
	return provider?.() ?? null;
}

export function subscribePresetTargetChanges(listener: () => void): () => void {
	targetChangeListeners.add(listener);
	return () => targetChangeListeners.delete(listener);
}
