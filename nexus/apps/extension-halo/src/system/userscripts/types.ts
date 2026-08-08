// goal: UserScripts type definitions - full feature parity with Tampermonkey
// eff: Unified types for script management

import type { ScriptRuntimeOwner } from '../../kernel/core/script-runtime-ownership';
import type { ScriptType } from '../../kernel/registry/taxonomy';
export type { ScriptRuntimeOwner } from '../../kernel/core/script-runtime-ownership';
export type { ScriptType };
export type UserScriptRunAt = 'document_start' | 'document_end' | 'document_idle';
export type UserScriptManagedBy = ScriptRuntimeOwner;

export interface UserScript {
	id: string;
	name: string;
	description: string;
	code: string;
	enabled: boolean;
	type: ScriptType;
	matches: string[];
	excludeMatches?: string[];
	runAt: UserScriptRunAt;
	world?: 'ISOLATED' | 'MAIN' | 'USER_SCRIPT';
	filePath?: string;
	order: number;
	version?: string;
	author?: string;
	homepage?: string;
	updateUrl?: string;
	category?: string;
	runCount: number;
	lastRun?: number;
	createdAt: number;
	updatedAt: number;
	saatToolId?: string;
	// Optional registry ownership metadata. Custom user-authored scripts omit
	// these fields; shared storage projections must preserve them when present.
	managedBy?: UserScriptManagedBy;
	moduleBuiltIn?: boolean;
}

export interface UserScriptState {
	scripts: UserScript[];
	globalEnabled: boolean;
	toolbarConfig?: {
		order: string[];
		hideOnOverflow: boolean;
	};
}

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
	[key: string]: string | string[] | undefined;
}

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
