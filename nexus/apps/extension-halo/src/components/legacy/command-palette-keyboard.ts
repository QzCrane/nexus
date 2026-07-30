export type CommandPaletteKeyAction = 'close' | 'next' | 'previous' | 'select-active' | null;

export function resolveCommandPaletteKeyAction(
	key: string,
	isSearchInput: boolean,
): CommandPaletteKeyAction {
	if (key === 'Escape') return 'close';
	if (key === 'ArrowDown') return 'next';
	if (key === 'ArrowUp') return 'previous';
	if (key === 'Enter' && isSearchInput) return 'select-active';
	return null;
}
