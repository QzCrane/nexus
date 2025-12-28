/**
 * SPECTRA Options - Internationalization
 */

import { DICT } from './i18n-dict';

let currentLang = 'en-US';
let onLangChangeCallbacks: (() => void)[] = [];

export async function initI18n(): Promise<void> {
	try {
		const result = await chrome.storage.local.get('globalSettings');
		currentLang = result.globalSettings?.language ?? 'en-US';
	} catch {
		currentLang = 'en-US';
	}

	const select = document.getElementById('lang-select') as HTMLSelectElement | null;
	if (select) {
		select.value = currentLang;
		select.addEventListener('change', async () => {
			currentLang = select.value;
			try {
				const result = await chrome.storage.local.get('globalSettings');
				await chrome.storage.local.set({
					globalSettings: { ...result.globalSettings, language: currentLang }
				});
			} catch { /* ignore */ }
			applyI18n();
			// Trigger callbacks (re-render dynamic content)
			onLangChangeCallbacks.forEach(cb => cb());
		});
	}

	applyI18n();
}

function applyI18n(): void {
	const dict = DICT[currentLang] ?? DICT['en-US'];
	if (!dict) return;

	document.querySelectorAll('[data-i18n]').forEach(el => {
		const key = el.getAttribute('data-i18n');
		if (key && dict[key]) {
			el.textContent = dict[key];
		}
	});
}

/** Get Translation */
export function t(key: string): string {
	const dict = DICT[currentLang] ?? DICT['en-US'];
	return dict?.[key] ?? key;
}

export function getCurrentLang(): string {
	return currentLang;
}

export function onLangChange(callback: () => void): void {
	onLangChangeCallbacks.push(callback);
}

// Re-export Action Names
export { getActionName } from './i18n-actions';
