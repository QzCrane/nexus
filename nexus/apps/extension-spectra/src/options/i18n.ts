/**
 * SPECTRA Options - 国际化
 */

const LANG_KEY = 'language';

// 简化的 Options 页 i18n 字典
const DICT: Record<string, Record<string, string>> = {
	'en-US': {
		opt_chrome_title: '🌐 Chrome Global Shortcuts',
		opt_chrome_open: 'Open Chrome Settings',
		opt_chrome_desc: 'These shortcuts work system-wide, even when Chrome is in background.',
		opt_site_title: '📑 Per-Site Hotkeys',
		opt_site_add: '+ Add current site...',
		opt_site_add_btn: 'Add',
		opt_site_desc: 'Custom hotkeys for specific websites. Disabled by default.',
		opt_site_enable: 'Enable on this site',
		opt_site_delete: 'Delete',
		opt_site_add_key: '+ Add Hotkey',
		opt_site_empty: 'No site-specific hotkeys configured. Select a site to customize.',
		modal_edit_title: 'Edit Hotkey',
		modal_key: 'Key Combination',
		modal_action: 'Action',
		modal_cancel: 'Cancel',
		modal_save: 'Save',
		slot_unbound: '(unbound)',
	},
	'zh-CN': {
		opt_chrome_title: '🌐 Chrome 全局快捷键',
		opt_chrome_open: '打开 Chrome 设置',
		opt_chrome_desc: '这些快捷键在系统范围内生效，即使 Chrome 在后台运行。',
		opt_site_title: '📑 网站独立配置',
		opt_site_add: '+ 添加当前网站...',
		opt_site_add_btn: '添加',
		opt_site_desc: '为特定网站自定义快捷键。默认关闭。',
		opt_site_enable: '在此网站启用',
		opt_site_delete: '删除',
		opt_site_add_key: '+ 添加快捷键',
		opt_site_empty: '暂无网站配置。选择一个网站进行自定义。',
		modal_edit_title: '编辑快捷键',
		modal_key: '按键组合',
		modal_action: '动作',
		modal_cancel: '取消',
		modal_save: '保存',
		slot_unbound: '(未绑定)',
	},
};

let currentLang = 'en-US';

/** 初始化国际化 */
export async function initI18n(): Promise<void> {
	// 加载保存的语言
	try {
		const result = await chrome.storage.local.get('globalSettings');
		currentLang = result.globalSettings?.language ?? 'en-US';
	} catch {
		currentLang = 'en-US';
	}

	// 设置选择器
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
		});
	}

	applyI18n();
}

/** 应用国际化 */
function applyI18n(): void {
	const dict = DICT[currentLang] ?? DICT['en-US'];
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
	return dict[key] ?? key;
}
