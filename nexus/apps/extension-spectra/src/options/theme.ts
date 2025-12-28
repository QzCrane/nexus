/**
 * SPECTRA Options - Theme Switching
 */

const THEME_KEY = 'theme';

export function initTheme(): void {
	// Load saved theme
	const saved = localStorage.getItem(THEME_KEY) ?? 'system';
	applyTheme(saved);

	// Bind toggle button
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

function applyTheme(theme: string): void {
	if (theme === 'system') {
		const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
		document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
	} else {
		document.documentElement.dataset.theme = theme;
	}
}

function updateIcon(theme: string): void {
	const btn = document.getElementById('theme-toggle');
	if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}
