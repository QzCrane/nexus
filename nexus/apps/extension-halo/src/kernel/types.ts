// goal: HALO kernel types
// Single source of truth for storage keys and tool identifiers

// Storage key prefixes by domain
export const STORAGE_PREFIX = {
	CORE: 'halo_',
	DARK_MODE: 'halo_dark_',
	TOOL: 'halo_tool_',
} as const;

// Tool identifiers
export type ToolId =
	| 'qrcode'
	| 'color-picker'
	| 'ruler'
	| 'json-formatter'
	| 'outline'
	| 'devtools'
	| 'clipboard'
	| 'screenshot'
	| 'tabs'
	| 'settings';

// Message types for inter-context communication
export type HaloMessageType =
	// Core
	| 'HALO_GET_STATUS'
	| 'HALO_TOOL_ACTIVATE'
	// Dark mode (paused)
	| 'HALO_DARK_MODE_TOGGLE'
	| 'HALO_WHITELIST_CHANGED';

export interface HaloMessage<T = unknown> {
	type: HaloMessageType;
	payload?: T;
}

// Tool state base interface
export interface ToolState {
	enabled: boolean;
	lastUsed?: number;
}

// Storage schema
export interface HaloStorage {
	// Core settings
	activeTool: ToolId | null;
	toolStates: Partial<Record<ToolId, ToolState>>;
	// Dark mode (paused)
	darkModeEnabled: boolean;
	darkModeWhitelist: string[];
	darkModeConfig: Record<string, unknown>;
	darkModeFixes: Record<string, unknown>;
}
