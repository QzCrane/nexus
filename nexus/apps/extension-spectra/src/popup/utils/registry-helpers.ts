/**
 * SPECTRA Popup - Registry Helpers
 */

import type { DomainEntry, DomainSource } from '@nexus/contracts';

const SOURCE_LABELS: Record<DomainSource, string> = {
	user: '',
	auto: '',
};

export function migrateRegistry(rawData: unknown): DomainEntry[] {
	if (!rawData) return [];
	// Already new format
	if (Array.isArray(rawData) && rawData.length > 0 && typeof rawData[0] === 'object') {
		return rawData as DomainEntry[];
	}
	// Old format: string[]
	if (Array.isArray(rawData) && rawData.every(d => typeof d === 'string')) {
		return (rawData as string[]).map((domain, i) => ({
			domain, source: 'user' as DomainSource, probed: false, addedAt: Date.now() - i,
		}));
	}
	return [];
}

export function formatEntry(e: DomainEntry): string {
	return `${SOURCE_LABELS[e.source] || ''} ${e.domain}`.trim();
}

export function parseEntry(line: string): DomainEntry {
	// Remove possible source markers
	const cleaned = line.replace(/^[📋✏️🔍]\s*/, '').trim();
	return { domain: cleaned, source: 'user', probed: false, addedAt: Date.now() };
}
