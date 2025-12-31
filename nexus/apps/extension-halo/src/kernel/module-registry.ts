// goal: Module metadata and registry types
// eff: Define structure for installable modules

import type { ToolId } from './types';
import type { ToolCategory } from '../i18n/types';

// Module installation status
export type ModuleStatus = 'available' | 'installed' | 'downloading' | 'updating' | 'error';

// Module metadata (from registry)
export interface ModuleMeta {
	id: string;
	name: string;
	description: string;
	version: string;
	category: ToolCategory;
	icon: string;
	size: number; // bytes
	dependencies?: string[];
	bundleUrl?: string; // URL to download module bundle
	builtIn?: boolean; // Core modules that can't be uninstalled
}

// Module state (local)
export interface ModuleState {
	id: string;
	status: ModuleStatus;
	installedVersion?: string;
	installedAt?: number;
	lastUsed?: number;
	error?: string;
}

// Module manager state
export interface ModuleManagerState {
	modules: Record<string, ModuleState>;
	downloading: string[];
	lastSync: number;
}

// Built-in core modules (always installed, cannot uninstall)
export const CORE_MODULES: ModuleMeta[] = [
	{ id: 'qrcode', name: 'QR Code', description: 'Generate and scan QR codes', version: '1.0.0', category: 'general', icon: '🔲', size: 45000, builtIn: true },
	{ id: 'screenshot', name: 'Screenshot', description: 'Capture page screenshots', version: '1.0.0', category: 'visual', icon: '📸', size: 25000, builtIn: true },
	{ id: 'color-picker', name: 'Color Picker', description: 'Pick colors from any page', version: '1.0.0', category: 'visual', icon: '🎨', size: 30000, builtIn: true },
	{ id: 'ruler', name: 'Page Ruler', description: 'Measure page elements', version: '1.0.0', category: 'visual', icon: '�', size: 35000, builtIn: true },
	{ id: 'json-formatter', name: 'JSON Formatter', description: 'Format and validate JSON', version: '1.0.0', category: 'dev', icon: '{}', size: 28000, builtIn: true },
	{ id: 'base64', name: 'Base64', description: 'Encode/decode Base64', version: '1.0.0', category: 'dev', icon: '64', size: 15000, builtIn: true },
	{ id: 'hash', name: 'Hash Generator', description: 'Generate MD5/SHA hashes', version: '1.0.0', category: 'dev', icon: '#', size: 20000, builtIn: true },
	{ id: 'uuid', name: 'UUID Generator', description: 'Generate UUIDs', version: '1.0.0', category: 'dev', icon: '🆔', size: 8000, builtIn: true },
	{ id: 'timestamp', name: 'Timestamp', description: 'Convert timestamps', version: '1.0.0', category: 'dev', icon: '⏱️', size: 10000, builtIn: true },
	{ id: 'url', name: 'URL Encoder', description: 'Encode/decode URLs', version: '1.0.0', category: 'dev', icon: '🔗', size: 10000, builtIn: true },
	{ id: 'module-store', name: 'Module Store', description: 'Manage tool modules', version: '1.0.0', category: 'general', icon: '🧩', size: 15000, builtIn: true },
	{ id: 'settings', name: 'Settings', description: 'Extension settings', version: '1.0.0', category: 'general', icon: '⚙️', size: 10000, builtIn: true },
];

// Optional modules (can be installed/uninstalled)
export const OPTIONAL_MODULES: ModuleMeta[] = [
	{ id: 'pdf', name: 'PDF Toolbox', description: 'Merge, split, rotate PDFs', version: '1.0.0', category: 'efficiency', icon: '📕', size: 380000 },
	{ id: 'regex', name: 'Regex Tester', description: 'Test regular expressions', version: '1.0.0', category: 'dev', icon: '.*', size: 22000 },
	{ id: 'outline', name: 'Page Outline', description: 'View page structure', version: '1.0.0', category: 'dev', icon: '📋', size: 28000 },
	{ id: 'clipboard', name: 'Clipboard History', description: 'Track clipboard history', version: '1.0.0', category: 'efficiency', icon: '📎', size: 32000 },
	{ id: 'smooth-scroll', name: 'Smooth Scroll', description: 'Enhanced scrolling', version: '1.0.0', category: 'efficiency', icon: '↕️', size: 25000 },
	{ id: 'tabs', name: 'Tab Manager', description: 'Manage browser tabs', version: '1.0.0', category: 'efficiency', icon: '📑', size: 40000 },
	{ id: 'crypto', name: 'Crypto Tools', description: 'JWT, RSA, AES encryption', version: '1.0.0', category: 'dev', icon: '🔐', size: 85000 },
	{ id: 'network', name: 'Network Utils', description: 'UA Parser, Curl converter', version: '1.0.0', category: 'dev', icon: '🌐', size: 45000 },
	{ id: 'mock-data', name: 'Mock Data', description: 'Generate test data', version: '1.0.0', category: 'dev', icon: '🎲', size: 55000 },
	{ id: 'archive', name: 'Web Archive', description: 'Save pages offline', version: '1.0.0', category: 'efficiency', icon: '💾', size: 120000 },
	{ id: 'userscripts', name: 'UserScripts', description: 'Custom JS injection', version: '1.0.0', category: 'dev', icon: '📜', size: 45000 },
	{ id: 'permissions', name: 'Permissions', description: 'Manage optional permissions', version: '1.0.0', category: 'efficiency', icon: '🔐', size: 25000 },
	// v0.6.0 Text/Code Tools
	{ id: 'text-tools', name: 'Text Tools', description: 'Case convert, stats, dedupe', version: '1.0.0', category: 'dev', icon: '📝', size: 30000 },
	{ id: 'lorem-ipsum', name: 'Lorem Ipsum', description: 'Generate placeholder text', version: '1.0.0', category: 'dev', icon: '📄', size: 15000 },
	{ id: 'diff', name: 'Diff Viewer', description: 'Compare text differences', version: '1.0.0', category: 'dev', icon: '🔍', size: 35000 },
	{ id: 'yaml', name: 'YAML Converter', description: 'YAML ↔ JSON conversion', version: '1.0.0', category: 'dev', icon: '📋', size: 25000 },
	{ id: 'number-base', name: 'Number Base', description: 'Base conversion (2/8/10/16)', version: '1.0.0', category: 'dev', icon: '🔢', size: 15000 },
	{ id: 'markdown', name: 'Markdown', description: 'Preview with live editor', version: '1.0.0', category: 'dev', icon: '📝', size: 30000 },
	{ id: 'unit-converter', name: 'Unit Converter', description: 'Length/weight/temp/time/data', version: '1.0.0', category: 'efficiency', icon: '⚖️', size: 25000 },
	{ id: 'cron', name: 'Cron Parser', description: 'Parse cron expressions', version: '1.0.0', category: 'dev', icon: '⏰', size: 20000 },
	{ id: 'html-entity', name: 'HTML Entity', description: 'Encode/decode HTML entities', version: '1.0.0', category: 'dev', icon: '🔤', size: 20000 },
	{ id: 'code-formatter', name: 'Code Formatter', description: 'Format & minify code', version: '1.0.0', category: 'dev', icon: '✨', size: 35000 },
	{ id: 'password-gen', name: 'Password Generator', description: 'Secure password creation', version: '1.0.0', category: 'security', icon: '🔐', size: 25000 },
	{ id: 'image-tools', name: 'Image Tools', description: 'Compress/convert images', version: '1.0.0', category: 'media', icon: '🖼️', size: 30000 },
	{ id: 'cookie-manager', name: 'Cookie Manager', description: 'View/edit site cookies', version: '1.0.0', category: 'browser', icon: '🍪', size: 20000 },
	{ id: 'reader-mode', name: 'Reader Mode', description: 'Distraction-free reading', version: '1.0.0', category: 'browser', icon: '📖', size: 25000 },
	{ id: 'totp', name: 'TOTP Authenticator', description: '2FA code generator', version: '1.0.0', category: 'security', icon: '🔐', size: 30000 },
	{ id: 'bookmark-manager', name: 'Bookmark Manager', description: 'Search/manage bookmarks', version: '1.0.0', category: 'browser', icon: '📚', size: 25000 },
	{ id: 'tech-stack', name: 'Tech Stack', description: 'Detect website technologies', version: '1.0.0', category: 'dev', icon: '🔬', size: 35000 },
	{ id: 'sticky-notes', name: 'Sticky Notes', description: 'Quick notes and reminders', version: '1.0.0', category: 'efficiency', icon: '📝', size: 20000 },
	{ id: 'pomodoro', name: 'Pomodoro Timer', description: 'Focus timer with breaks', version: '1.0.0', category: 'efficiency', icon: '🍅', size: 25000 },
	{ id: 'timer', name: 'Timer & Stopwatch', description: 'Countdown and stopwatch', version: '1.0.0', category: 'efficiency', icon: '⏱️', size: 20000 },
	{ id: 'http-status', name: 'HTTP Status', description: 'HTTP status code reference', version: '1.0.0', category: 'dev', icon: '🌐', size: 25000 },
	{ id: 'csv-viewer', name: 'CSV Viewer', description: 'Parse and view CSV data', version: '1.0.0', category: 'dev', icon: '📊', size: 25000 },
	{ id: 'shortcuts', name: 'Shortcuts', description: 'Keyboard shortcuts reference', version: '1.0.0', category: 'efficiency', icon: '⌨️', size: 20000 },
	{ id: 'ip-lookup', name: 'IP Lookup', description: 'Query IP address info', version: '1.0.0', category: 'dev', icon: '🌍', size: 20000 },
	{ id: 'font-inspector', name: 'Font Inspector', description: 'Identify page fonts', version: '1.0.0', category: 'dev', icon: '🔤', size: 25000 },
	{ id: 'xml-formatter', name: 'XML Formatter', description: 'Format and validate XML', version: '1.0.0', category: 'dev', icon: '📄', size: 25000 },
	{ id: 'history-search', name: 'History Search', description: 'Search browsing history', version: '1.0.0', category: 'browser', icon: '📜', size: 20000 },
	{ id: 'headers-viewer', name: 'Headers Viewer', description: 'View HTTP headers', version: '1.0.0', category: 'dev', icon: '📋', size: 20000 },
	{ id: 'exif-reader', name: 'EXIF Reader', description: 'Read image metadata', version: '1.0.0', category: 'media', icon: '📷', size: 25000 },
	{ id: 'table-extractor', name: 'Table Extractor', description: 'Extract tables to CSV', version: '1.0.0', category: 'browser', icon: '📊', size: 25000 },
	{ id: 'todo-list', name: 'Todo List', description: 'Task management', version: '1.0.0', category: 'efficiency', icon: '✅', size: 15000 },
	{ id: 'storage-editor', name: 'Storage Editor', description: 'Edit localStorage', version: '1.0.0', category: 'dev', icon: '📦', size: 20000 },
	{ id: 'text-to-speech', name: 'Text to Speech', description: 'Read text aloud', version: '1.0.0', category: 'efficiency', icon: '🔊', size: 15000 },
	{ id: 'user-agent', name: 'User Agent', description: 'UA string reference', version: '1.0.0', category: 'dev', icon: '🌐', size: 15000 },
	{ id: 'color-palette', name: 'Color Palette', description: 'Extract colors from images', version: '1.0.0', category: 'visual', icon: '🎨', size: 20000 },
	{ id: 'gzip', name: 'Gzip', description: 'Compress/decompress gzip', version: '1.0.0', category: 'dev', icon: '🗜️', size: 15000 },
	{ id: 'jwt-decoder', name: 'JWT Decoder', description: 'Decode JWT tokens', version: '1.0.0', category: 'dev', icon: '🔑', size: 15000 },
	{ id: 'morse', name: 'Morse Code', description: 'Encode/decode morse', version: '1.0.0', category: 'dev', icon: '📡', size: 15000 },
	{ id: 'emoji-picker', name: 'Emoji Picker', description: 'Browse and copy emojis', version: '1.0.0', category: 'efficiency', icon: '😀', size: 20000 },
];

// All modules combined
export const ALL_MODULES: ModuleMeta[] = [...CORE_MODULES, ...OPTIONAL_MODULES];

// Get module by ID
export const getModuleMeta = (id: string): ModuleMeta | undefined => ALL_MODULES.find((m) => m.id === id);

// Format size for display
export const formatModuleSize = (bytes: number): string => {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1048576).toFixed(1)} MB`;
};
