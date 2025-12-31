// goal: Headers Viewer type definitions

export interface HeaderInfo {
	name: string;
	value: string;
	category: HeaderCategory;
}

export type HeaderCategory = 'request' | 'response' | 'security' | 'caching' | 'other';
