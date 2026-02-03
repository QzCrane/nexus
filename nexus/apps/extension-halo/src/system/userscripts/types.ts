// goal: UserScripts type definitions - full feature parity with Tampermonkey
// eff: Unified types for script management

export type ScriptType = 'javascript' | 'typescript' | 'css';
export type UserScriptRunAt = 'document_start' | 'document_end' | 'document_idle';

export interface UserScript {
	id: string;
	name: string;
	description: string;
	code: string;
	enabled: boolean;
	type: ScriptType;
	matches: string[];           // URL patterns, e.g., "*://*.example.com/*"
	excludeMatches?: string[];   // Exclude patterns
	runAt: UserScriptRunAt;
	world?: 'ISOLATED' | 'MAIN' | 'USER_SCRIPT';
	filePath?: string;
	order: number;               // Execution order (lower = earlier)
	// Metadata
	version?: string;
	author?: string;
	homepage?: string;
	updateUrl?: string;
	// Category matching Module Store
	category?: string;
	// Statistics
	runCount: number;
	lastRun?: number;
	// Timestamps
	createdAt: number;
	updatedAt: number;
}

export interface UserScriptState {
	scripts: UserScript[];
	globalEnabled: boolean;
	toolbarConfig?: {
		order: string[];
		hideOnOverflow: boolean;
	};
}

// Parsed Userscript header (// ==UserScript== format)
export interface ParsedHeader {
	name?: string;
	description?: string;
	category?: string;
	version?: string;
	author?: string;
	match?: string[];
	exclude?: string[];
	'run-at'?: string;
	homepage?: string;
	updateURL?: string;
	grant?: string[];
}

// Export/Import format
export interface ScriptExport {
	version: '1.0';
	exportedAt: number;
	scripts: UserScript[];
}

export interface EditForm {
	name: string;
	description: string;
	category: string;
	code: string;
	matches: string;
	excludeMatches: string;
	type: ScriptType;
	runAt: UserScriptRunAt;
}
