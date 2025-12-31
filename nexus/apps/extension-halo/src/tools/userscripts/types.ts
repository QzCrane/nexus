// goal: UserScripts type definitions

export interface UserScript {
	id: string;
	name: string;
	description: string;
	code: string;
	enabled: boolean;
	matches: string[];       // URL patterns, e.g., "*://*.example.com/*"
	runAt: 'document_start' | 'document_end' | 'document_idle';
	createdAt: number;
	updatedAt: number;
}

export interface UserScriptState {
	scripts: UserScript[];
	globalEnabled: boolean;
}

export type UserScriptRunAt = UserScript['runAt'];
