/**
 * SPECTRA Options - 国际化
 */

import { DICT } from './i18n-dict';

let currentLang = 'en-US';
let onLangChangeCallbacks: (() => void)[] = [];

/** 初始化国际化 */
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
			// 触发所有回调 (重新渲染动态内容)
			onLangChangeCallbacks.forEach(cb => cb());
		});
	}

	applyI18n();
}

/** 应用国际化 */
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

/** 获取翻译 */
export function t(key: string): string {
	const dict = DICT[currentLang] ?? DICT['en-US'];
	return dict?.[key] ?? key;
}

/** 获取当前语言 */
export function getCurrentLang(): string {
	return currentLang;
}

/** 注册语言变化回调 */
export function onLangChange(callback: () => void): void {
	onLangChangeCallbacks.push(callback);
}

// 重导出 Action 名称
export { getActionName } from './i18n-actions';
