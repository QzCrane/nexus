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
	| 'smooth-scroll'
	| 'regex'
	| 'base64'
	| 'hash'
	| 'uuid'
	| 'timestamp'
	| 'url'
	| 'pdf'
	| 'crypto'
	| 'mock-data'
	| 'network'
	| 'archive'
	| 'userscripts'
	| 'permissions'
	| 'text-tools'
	| 'lorem-ipsum'
	| 'diff'
	| 'yaml'
	| 'number-base'
	| 'markdown'
	| 'unit-converter'
	| 'cron'
	| 'html-entity'
	| 'code-formatter'
	| 'password-gen'
	| 'image-tools'
	| 'cookie-manager'
	| 'reader-mode'
	| 'totp'
	| 'bookmark-manager'
	| 'tech-stack'
	| 'sticky-notes'
	| 'pomodoro'
	| 'timer'
	| 'http-status'
	| 'csv-viewer'
	| 'shortcuts'
	| 'ip-lookup'
	| 'font-inspector'
	| 'xml-formatter'
	| 'history-search'
	| 'headers-viewer'
	| 'exif-reader'
	| 'table-extractor'
	| 'todo-list'
	| 'storage-editor'
	| 'text-to-speech'
	| 'user-agent'
	| 'color-palette'
	| 'gzip'
	| 'jwt-decoder'
	| 'morse'
	| 'emoji-picker'
	| 'module-store'
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
