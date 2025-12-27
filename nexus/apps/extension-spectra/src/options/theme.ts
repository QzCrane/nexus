/**
 * SPECTRA Options - 主题切换
 */

const THEME_KEY = 'theme';

/** 初始化主题 */
export function initTheme(): void {
	// 加载保存的主题
	const saved = localStorage.getItem(THEME_KEY) ?? 'system';
	applyTheme(saved);

	// 绑定切换按钮
	const btn = document.getElementById('theme-toggle');
	if (btn) {
		btn.addEventListener('click', () => {
			const current = document.documentElement.dataset.theme ?? 'light';
			const next = current === 'dark' ? 'light' : 'dark';
			localStorage.setItem(THEME_KEY, next);
			applyTheme(next);
			updateIcon(next);
		});
		updateIcon(document.documentElement.dataset.theme ?? 'light');
	}
}

/** 应用主题 */
function applyTheme(theme: string): void {
	if (theme === 'system') {
		const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
		document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
	} else {
		document.documentElement.dataset.theme = theme;
	}
}

/** 更新图标 */
function updateIcon(theme: string): void {
	const btn = document.getElementById('theme-toggle');
	if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}
