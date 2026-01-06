// goal: Resource type key detection helper
// eff: Determines whether to show image or video based on pressed modifiers

import type { ResourceKeys, KeyCombo } from '../types';

/**
 * Detected resource preference based on current key state
 */
export type ResourcePreference = 'image' | 'video' | 'auto';

/**
 * Check if a KeyCombo matches the current event state
 */
function comboMatches(combo: KeyCombo, e: MouseEvent | KeyboardEvent): boolean {
	return combo.shift === e.shiftKey &&
		combo.ctrl === e.ctrlKey &&
		combo.alt === e.altKey;
}

/**
 * Check if current event state is a superset of a combo
 * (all required keys are pressed, possibly more)
 */
function comboIsSubset(combo: KeyCombo, e: MouseEvent | KeyboardEvent): boolean {
	// combo keys that are true must also be true in event
	if (combo.shift && !e.shiftKey) return false;
	if (combo.ctrl && !e.ctrlKey) return false;
	if (combo.alt && !e.altKey) return false;
	return true;
}

/**
 * Count how many modifiers are required by a combo
 */
function comboModifierCount(combo: KeyCombo): number {
	let count = 0;
	if (combo.shift) count++;
	if (combo.ctrl) count++;
	if (combo.alt) count++;
	return count;
}

/**
 * Check if a combo is "none" (no modifiers required)
 */
function isComboNone(combo: KeyCombo): boolean {
	return !combo.shift && !combo.ctrl && !combo.alt;
}

/**
 * Determine which resource type to show based on current modifiers.
 * 
 * Key matching logic:
 * 1. Exact match wins (e.g., Alt+Ctrl pressed matches { alt: true, ctrl: true })
 * 2. If no exact match, more specific combo (more modifiers) wins
 * 3. If neither matches exactly, check if current state is superset of combo
 * 
 * Seamless switching example:
 * - imageKey: { alt: true, ctrl: false }  -> Alt only
 * - videoKey: { alt: true, ctrl: true }   -> Alt+Ctrl
 * 
 * When user presses Alt -> shows image
 * When user adds Ctrl (now Alt+Ctrl) -> switches to video
 */
export function detectResourcePreference(
	resourceKeys: ResourceKeys,
	e: MouseEvent | KeyboardEvent
): ResourcePreference | null {
	const { imageKey, videoKey } = resourceKeys;

	// Check exact matches first
	const imageExact = comboMatches(imageKey, e);
	const videoExact = comboMatches(videoKey, e);

	if (imageExact && !videoExact) return 'image';
	if (videoExact && !imageExact) return 'video';
	if (imageExact && videoExact) {
		// Both exact match (same config) - return auto
		return 'auto';
	}

	// No exact match - check if current state is superset of either
	const imageSubset = comboIsSubset(imageKey, e);
	const videoSubset = comboIsSubset(videoKey, e);

	if (!imageSubset && !videoSubset) {
		// Neither matches - don't trigger
		return null;
	}

	// One or both match as subset - prefer the more specific one
	const imageCount = comboModifierCount(imageKey);
	const videoCount = comboModifierCount(videoKey);

	if (imageSubset && videoSubset) {
		// Both match - prefer more specific (more keys)
		if (videoCount > imageCount) return 'video';
		if (imageCount > videoCount) return 'image';
		// Same count - prefer video (more specific action)
		return 'video';
	}

	if (videoSubset) return 'video';
	if (imageSubset) return 'image';

	return null;
}

/**
 * Check if the trigger should activate based on modifiers and resource keys.
 * Returns true if any valid combination is detected.
 */
export function shouldTriggerActivate(
	resourceKeys: ResourceKeys,
	e: MouseEvent | KeyboardEvent
): boolean {
	const pref = detectResourcePreference(resourceKeys, e);
	return pref !== null;
}

/**
 * Validate resource keys configuration.
 * Returns error message if invalid, null if valid.
 */
export function validateResourceKeys(resourceKeys: ResourceKeys): string | null {
	const { imageKey, videoKey } = resourceKeys;

	// Both combos being identical is fine (auto mode)
	// Just check they're valid KeyCombo objects
	if (typeof imageKey !== 'object' || typeof videoKey !== 'object') {
		return 'Invalid KeyCombo format';
	}

	return null;
}

/**
 * Convert KeyCombo to human-readable string for display
 */
export function comboToString(combo: KeyCombo): string {
	if (isComboNone(combo)) return 'None';

	const parts: string[] = [];
	if (combo.alt) parts.push('Alt');
	if (combo.ctrl) parts.push('Ctrl');
	if (combo.shift) parts.push('Shift');
	return parts.join('+');
}
