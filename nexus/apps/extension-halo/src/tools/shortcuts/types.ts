// goal: Shortcuts type definitions

export interface ShortcutGroup {
	name: string;
	icon: string;
	shortcuts: Shortcut[];
}

export interface Shortcut {
	keys: string;
	description: string;
}
