// goal: Shortcuts core logic - shortcut database

import type { ShortcutGroup } from './types';

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
	{
		name: 'Browser', icon: '🌐',
		shortcuts: [
			{ keys: 'Ctrl+T', description: 'New tab' },
			{ keys: 'Ctrl+W', description: 'Close tab' },
			{ keys: 'Ctrl+Shift+T', description: 'Reopen closed tab' },
			{ keys: 'Ctrl+Tab', description: 'Next tab' },
			{ keys: 'Ctrl+Shift+Tab', description: 'Previous tab' },
			{ keys: 'Ctrl+L', description: 'Focus address bar' },
			{ keys: 'Ctrl+D', description: 'Bookmark page' },
			{ keys: 'Ctrl+H', description: 'History' },
			{ keys: 'Ctrl+J', description: 'Downloads' },
			{ keys: 'F5', description: 'Refresh' },
			{ keys: 'Ctrl+F5', description: 'Hard refresh' },
			{ keys: 'Ctrl+F', description: 'Find in page' },
		],
	},
	{
		name: 'DevTools', icon: '🔧',
		shortcuts: [
			{ keys: 'F12', description: 'Open DevTools' },
			{ keys: 'Ctrl+Shift+I', description: 'Open DevTools' },
			{ keys: 'Ctrl+Shift+J', description: 'Console' },
			{ keys: 'Ctrl+Shift+C', description: 'Inspect element' },
			{ keys: 'Ctrl+Shift+M', description: 'Toggle device mode' },
			{ keys: 'Ctrl+Shift+P', description: 'Command palette' },
			{ keys: 'Ctrl+]', description: 'Next panel' },
			{ keys: 'Ctrl+[', description: 'Previous panel' },
		],
	},
	{
		name: 'Text Editing', icon: '📝',
		shortcuts: [
			{ keys: 'Ctrl+C', description: 'Copy' },
			{ keys: 'Ctrl+X', description: 'Cut' },
			{ keys: 'Ctrl+V', description: 'Paste' },
			{ keys: 'Ctrl+A', description: 'Select all' },
			{ keys: 'Ctrl+Z', description: 'Undo' },
			{ keys: 'Ctrl+Y', description: 'Redo' },
			{ keys: 'Ctrl+F', description: 'Find' },
			{ keys: 'Ctrl+H', description: 'Replace' },
		],
	},
	{
		name: 'VS Code', icon: '💻',
		shortcuts: [
			{ keys: 'Ctrl+P', description: 'Quick open file' },
			{ keys: 'Ctrl+Shift+P', description: 'Command palette' },
			{ keys: 'Ctrl+B', description: 'Toggle sidebar' },
			{ keys: 'Ctrl+`', description: 'Toggle terminal' },
			{ keys: 'Ctrl+/', description: 'Toggle comment' },
			{ keys: 'Alt+Up/Down', description: 'Move line' },
			{ keys: 'Ctrl+D', description: 'Select next match' },
			{ keys: 'Ctrl+Shift+L', description: 'Select all matches' },
			{ keys: 'F2', description: 'Rename symbol' },
			{ keys: 'F12', description: 'Go to definition' },
		],
	},
	{
		name: 'Windows', icon: '🪟',
		shortcuts: [
			{ keys: 'Win+D', description: 'Show desktop' },
			{ keys: 'Win+E', description: 'Open Explorer' },
			{ keys: 'Win+L', description: 'Lock screen' },
			{ keys: 'Win+Tab', description: 'Task view' },
			{ keys: 'Alt+Tab', description: 'Switch windows' },
			{ keys: 'Win+Shift+S', description: 'Screenshot' },
			{ keys: 'Win+V', description: 'Clipboard history' },
			{ keys: 'Win+.', description: 'Emoji picker' },
		],
	},
];

// Search shortcuts
export function searchShortcuts(query: string): ShortcutGroup[] {
	const q = query.toLowerCase().trim();
	if (!q) return SHORTCUT_GROUPS;

	return SHORTCUT_GROUPS.map((g) => ({
		...g,
		shortcuts: g.shortcuts.filter((s) =>
			s.keys.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
		),
	})).filter((g) => g.shortcuts.length > 0);
}
