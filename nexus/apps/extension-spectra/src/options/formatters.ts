// goal: provides utility functions for formatting and parsing UI-facing hotkey strings and action parameters

import {
	isFiniteControlValue,
	type KeyCombo,
	type HotkeyAction,
	type HotkeyBinding,
} from '@nexus/contracts';

// eff: converts a KeyCombo object into a standardized, human-readable string (e.g., 'Ctrl + Alt + K')
export function formatKeyCombo(key: KeyCombo): string {
	const parts: string[] = [];
	if (key.modifiers.ctrl) parts.push('Ctrl');
	if (key.modifiers.alt) parts.push('Alt');
	if (key.modifiers.shift) parts.push('Shift');
	if (key.modifiers.meta) parts.push('Meta');

	// note: strip internal 'Key', 'Digit', 'Arrow' prefixes to simplify display labels
	const keyName = key.code
		.replace('Key', '')
		.replace('Digit', '')
		.replace('Arrow', '')
		.replace('Numpad', 'Num');

	if (keyName) parts.push(keyName);

	return parts.join(' + ') || '(none)';
}

// eff: transforms an internal snake_case action identifier into a Title Case display name
export function formatActionName(action: string): string {
	return action
		.replace(/_/g, ' ')
		.replace(/\b\w/g, c => c.toUpperCase());
}

// eff: serializes optional action parameters into an editable string representation based on the action type
export function formatParams(action: HotkeyAction, params: NonNullable<HotkeyBinding['params']>): string {
	switch (action) {
		case 'speed_set': return String(params.speed ?? '');
		case 'volume_set': return String(params.volume ?? '');
		case 'run_js': return params.script ?? '';
		case 'open_url': return params.url ?? '';
		default: return '';
	}
}

// eff: converts raw user input strings back into structured parameters appropriate for the selected HotkeyAction
export function parseParams(action: HotkeyAction, value: string): HotkeyBinding['params'] {
	const normalizedValue = value.trim();
	switch (action) {
		case 'speed_set': {
			if (!normalizedValue) return undefined;
			const speed = Number(normalizedValue);
			return isFiniteControlValue(speed, 'speed') ? { speed } : undefined;
		}
		case 'volume_set': {
			if (!normalizedValue) return undefined;
			const volume = Number(normalizedValue);
			return isFiniteControlValue(volume, 'volume') ? { volume } : undefined;
		}
		case 'run_js': return normalizedValue ? { script: value } : undefined;
		case 'open_url': {
			try {
				const url = new URL(normalizedValue);
				return url.protocol === 'http:' || url.protocol === 'https:' ? { url: url.href } : undefined;
			} catch {
				return undefined;
			}
		}
		default: return undefined;
	}
}
