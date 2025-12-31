// goal: HTML Entity type definitions

export type EntityMode = 'encode' | 'decode';

export interface EntityConfig {
	mode: EntityMode;
	encodeAll: boolean; // Encode all characters or only special ones
}
