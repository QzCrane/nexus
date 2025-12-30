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
	// Future modules (not yet implemented)
	{ id: 'crypto', name: 'Crypto Tools', description: 'JWT, RSA, AES encryption', version: '1.0.0', category: 'dev', icon: '🔐', size: 85000 },
	{ id: 'network', name: 'Network Utils', description: 'UA Parser, Curl converter', version: '1.0.0', category: 'dev', icon: '🌐', size: 45000 },
	{ id: 'mock-data', name: 'Mock Data', description: 'Generate test data', version: '1.0.0', category: 'dev', icon: '🎲', size: 55000 },
	{ id: 'archive', name: 'Web Archive', description: 'Save pages offline', version: '1.0.0', category: 'efficiency', icon: '💾', size: 120000 },
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
