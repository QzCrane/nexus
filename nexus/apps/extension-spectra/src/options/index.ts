/**
 * SPECTRA Options - 主入口
 * 
 * Chrome Slots 配置 + 网站独立配置 + 国际化 + 主题
 */

import { initTheme } from './theme';
import { initI18n } from './i18n';
import { initSlotsEditor } from './slots-editor';
import { initSiteEditor } from './site-editor';
import { initModal } from './modal';

async function init(): Promise<void> {
	console.log('[SPECTRA] Options page initializing...');

	// 初始化主题
	initTheme();

	// 初始化国际化
	await initI18n();

	// 初始化弹窗
	initModal();

	// 初始化 Chrome Slots 编辑器
	await initSlotsEditor();

	// 初始化网站配置编辑器
	await initSiteEditor();

	// Chrome shortcuts 链接处理
	const link = document.getElementById('chrome-shortcuts-link');
	if (link) {
		link.addEventListener('click', (e) => {
			e.preventDefault();
			chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
		});
	}

	console.log('[SPECTRA] Options page ready');
}

document.addEventListener('DOMContentLoaded', init);
