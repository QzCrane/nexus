// goal: Resource type key detection helper
// eff: Determines whether to show image or video based on pressed modifiers

import type { ResourceKeys, KeyCombo } from '../../types';

/**
 * Detected resource preference based on current key state
 */
export type ResourcePreference = 'image' | 'video' | 'auto';

/**
 * Check if a KeyCombo matches the current event state
 */
function comboMatches(combo: KeyCombo, e: MouseEvent | KeyboardEvent): boolean {
	if (combo.disabled) return false;
	return combo.shift === e.shiftKey &&
		combo.ctrl === e.ctrlKey &&
		combo.alt === e.altKey;
}

/**
 * Check if a combo is "none" (no modifiers required)
 */
function isComboNone(combo: KeyCombo): boolean {
	return !combo.disabled && !combo.shift && !combo.ctrl && !combo.alt;
}

/**
 * Determine which resource type to show based on current modifiers.
 * 
 * EXACT MATCH ONLY - no subset matching!
 * 
 * Key matching logic:
 * - imageKey: { alt: true, ctrl: false }  -> Alt only (Ctrl must NOT be pressed)
 * - videoKey: { alt: true, ctrl: true }   -> Alt+Ctrl (both must be pressed)
 * 
 * When user presses Alt only -> shows image
 * When user presses Alt+Ctrl -> shows video (replaces image)
 * When user presses Ctrl only -> nothing (no match)
 * When user releases Alt (Ctrl still held) -> nothing (no match, close viewer)
 */
export function detectResourcePreference(
	resourceKeys: ResourceKeys,
	e: MouseEvent | KeyboardEvent
): ResourcePreference | null {
	const { imageKey, videoKey } = resourceKeys;

	// Check for disabled keys first
	if (imageKey.disabled && videoKey.disabled) return null;

	// EXACT match only - all modifiers must match exactly
	const imageExact = comboMatches(imageKey, e);
	const videoExact = comboMatches(videoKey, e);

	// Priority: video > image (when both exactly match, e.g. same config or both None)
	if (videoExact) return 'video';
	if (imageExact) return 'image';

	// No exact match - don't trigger
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
