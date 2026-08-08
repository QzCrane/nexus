// goal: Resource type key detection helper
// eff: Determines whether to show image or video based on pressed modifiers

import type { ResourceKeys, KeyCombo } from '../../types';

/**
 * Detected resource preference based on current key state
 */
export type ResourcePreference = 'image' | 'video' | 'auto';

export interface ModifierSnapshot {
	shiftKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
}

/** Check if a KeyCombo matches the current modifier state. */
function comboMatches(combo: KeyCombo, event: ModifierSnapshot): boolean {
	if (combo.disabled) return false;
	return combo.shift === event.shiftKey &&
		combo.ctrl === event.ctrlKey &&
		combo.alt === event.altKey;
}

/** Check if a combo is "none" (no modifiers required). */
function isComboNone(combo: KeyCombo): boolean {
	return !combo.disabled && !combo.shift && !combo.ctrl && !combo.alt;
}

/** Determine which resource type to show based on exact current modifiers. */
export function detectResourcePreference(
	resourceKeys: ResourceKeys,
	event: ModifierSnapshot
): ResourcePreference | null {
	const { imageKey, videoKey } = resourceKeys;
	if (imageKey.disabled && videoKey.disabled) return null;

	const imageExact = comboMatches(imageKey, event);
	const videoExact = comboMatches(videoKey, event);
	if (videoExact) return 'video';
	if (imageExact) return 'image';
	return null;
}

/** Check if any configured resource key is active. */
export function shouldTriggerActivate(
	resourceKeys: ResourceKeys,
	event: ModifierSnapshot
): boolean {
	return detectResourcePreference(resourceKeys, event) !== null;
}

/** Validate resource keys configuration. */
export function validateResourceKeys(resourceKeys: ResourceKeys): string | null {
	const { imageKey, videoKey } = resourceKeys;
	if (typeof imageKey !== 'object' || typeof videoKey !== 'object') {
		return 'Invalid KeyCombo format';
	}
	return null;
}

/** Convert a key combination to display text. */
export function comboToString(combo: KeyCombo): string {
	if (isComboNone(combo)) return 'None';

	const parts: string[] = [];
	if (combo.alt) parts.push('Alt');
	if (combo.ctrl) parts.push('Ctrl');
	if (combo.shift) parts.push('Shift');
	return parts.join('+');
}
