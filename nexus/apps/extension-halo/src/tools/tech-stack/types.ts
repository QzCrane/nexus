// goal: Tech Stack type definitions

export interface TechDetection {
	name: string;
	category: TechCategory;
	version?: string;
	confidence: number;
	icon?: string;
}

export type TechCategory =
	| 'framework'
	| 'library'
	| 'cms'
	| 'analytics'
	| 'cdn'
	| 'server'
	| 'language'
	| 'other';
