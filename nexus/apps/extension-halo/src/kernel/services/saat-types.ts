export interface SaaTScriptState {
	id: string;
	name: string;
	description: string;
	code: string;
	enabled: boolean;
	type: 'javascript' | 'css';
	matches: string[];
	excludeMatches: string[];
	runAt: 'document_start' | 'document_end' | 'document_idle';
	order: number;
	runCount: number;
	createdAt: number;
	updatedAt: number;
	// SaaT marker
	saatToolId: string;
}
