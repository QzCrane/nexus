/**
 * SPECTRA Options - Formatters
 */

import type { KeyCombo, HotkeyAction, HotkeyBinding } from '@nexus/contracts';

/** Format KeyCombo for display */
export function formatKeyCombo(key: KeyCombo): string {
	const parts: string[] = [];
	if (key.modifiers.ctrl) parts.push('Ctrl');
	if (key.modifiers.alt) parts.push('Alt');
	if (key.modifiers.shift) parts.push('Shift');
	if (key.modifiers.meta) parts.push('Meta');

	// Convert code to readable name
	let keyName = key.code
		.replace('Key', '')
		.replace('Digit', '')
		.replace('Arrow', '')
		.replace('Numpad', 'Num');

	if (keyName) parts.push(keyName);

	return parts.join(' + ') || '(none)';
}

export function formatActionName(action: string): string {
	return action
		.replace(/_/g, ' ')
		.replace(/\b\w/g, c => c.toUpperCase());
}

export function formatParams(action: HotkeyAction, params: NonNullable<HotkeyBinding['params']>): string {
	switch (action) {
		case 'speed_set': return String(params.speed ?? '');
		case 'volume_set': return String(params.volume ?? '');
		case 'run_js': return params.script ?? '';
		case 'open_url': return params.url ?? '';
		default: return '';
	}
}

export function parseParams(action: HotkeyAction, value: string): HotkeyBinding['params'] {
	switch (action) {
		case 'speed_set': return { speed: parseFloat(value) || 1 };
		case 'volume_set': return { volume: parseInt(value) || 100 };
		case 'run_js': return { script: value };
		case 'open_url': return { url: value };
		default: return undefined;
	}
}
