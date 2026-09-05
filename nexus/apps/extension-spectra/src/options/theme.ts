// goal: manages the options page theme persistence and visual toggle state

import type { SettingsUiSnapshot, ThemeMode } from '@nexus/contracts/ui-settings-runtime';
import {
	getOptionsSettingsSnapshot,
	patchOptionsSettings,
	subscribeOptionsSettingsSnapshots,
} from '../shared/options-settings-client';
import { createSerializedToggleQueue } from '../shared/serialized-toggle';
import { clearOptionsError, showOptionsError } from './status';

const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
let currentMode: ThemeMode = 'system';
let projectedRevision = -1;
let unsubscribeSettings: (() => void) | null = null;
let systemThemeListener: (() => void) | null = null;

function disposeThemeListeners(): void {
	unsubscribeSettings?.();
	unsubscribeSettings = null;
	if (systemThemeListener) {
		systemTheme.removeEventListener('change', systemThemeListener);
		systemThemeListener = null;
	}
}

// eff: restores the user's preferred theme from storage and binds the toggle button listener
export async function initTheme(): Promise<void> {
	disposeThemeListeners();
	projectedRevision = -1;
	const projectTheme = (snapshot: SettingsUiSnapshot): void => {
		if (snapshot.revision <= projectedRevision) return;
		projectedRevision = snapshot.revision;
		currentMode = snapshot.globalSettings.themeMode;
		applyTheme(currentMode);
		updateIcon(document.documentElement.dataset.theme ?? 'light');
	};
	unsubscribeSettings = subscribeOptionsSettingsSnapshots(projectTheme);
	projectTheme(await getOptionsSettingsSnapshot());

	const btn = document.getElementById('theme-toggle');
	if (btn) {
		const toggleQueue = createSerializedToggleQueue<ThemeMode>({
			readCurrent: () => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
			nextValue: current => current === 'dark' ? 'light' : 'dark',
			commit: async candidate => {
				projectTheme(await patchOptionsSettings({ scope: 'global', changes: { themeMode: candidate } }));
				clearOptionsError();
			},
			setBusy: busy => {
				if (busy) btn.setAttribute('aria-busy', 'true');
				else btn.removeAttribute('aria-busy');
			},
			onError: showOptionsError,
		});
		btn.onclick = () => {
			void toggleQueue.enqueue();
		};
		updateIcon(document.documentElement.dataset.theme ?? 'light');
	}

	systemThemeListener = () => {
		if (currentMode !== 'system') return;
		applyTheme(currentMode);
		updateIcon(document.documentElement.dataset.theme ?? 'light');
	};
	systemTheme.addEventListener('change', systemThemeListener);

	window.addEventListener('pagehide', disposeThemeListeners, { once: true });
}

// eff: injects the theme identifier into the document root for CSS targeting, resolving 'system' to light/dark
function applyTheme(theme: ThemeMode): void {
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
