// goal: Type definitions for code-snippets tool

export interface Snippet {
	id: string;
	title: string;
	code: string;
	language: Language;
	tags: string[];
	createdAt: number;
	updatedAt: number;
}

export type Language =
	| 'javascript' | 'typescript' | 'python' | 'go' | 'rust'
	| 'java' | 'cpp' | 'csharp' | 'php' | 'ruby'
	| 'html' | 'css' | 'sql' | 'json' | 'yaml'
	| 'bash' | 'powershell' | 'markdown' | 'plaintext';

export interface SnippetFilter {
	search: string;
	language: Language | 'all';
	tag: string;
}
