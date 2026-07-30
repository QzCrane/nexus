// Enhanced resolution result type

import type { RuleMetadata } from '../../rules/types';

export interface EnhancedResult {
	type: 'image' | 'video' | 'svg';
	url: string;
	audioUrl?: string;
	headers?: Record<string, string>;
	caption?: string;
	element: HTMLElement;
	originalUrl?: string;
	fromRule: string | null;
	fileSize?: number;  // File size in bytes (if available)
	metadata?: RuleMetadata;
}
