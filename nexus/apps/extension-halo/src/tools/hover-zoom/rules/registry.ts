// goal: Rule registry for Hover Zoom site-specific rules
// eff: Lazy loading, host-based lookup, caching

import type { SiteRule, RuleRegistryEntry } from './types';

// Registry of all site rules (lazy loaded)
const registry: RuleRegistryEntry[] = [
	{
		id: 'bilibili',
		hostPatterns: ['bilibili.com', 'bilibili.tv'],
		loader: () => import('./sites/bilibili').then(m => m.default)
	},
	// Future rules:
	// { id: 'twitter', hostPatterns: ['twitter.com', 'x.com'], loader: () => import('./sites/twitter').then(m => m.default) },
];

// Loaded rules cache
const loadedRules = new Map<string, SiteRule>();

/**
 * Get all rules matching the current host
 * @param host - Current page hostname
 * @returns Array of matching rules, sorted by priority
 */
export async function getRulesForHost(host: string): Promise<SiteRule[]> {
	const matchingEntries = registry.filter(entry =>
		entry.hostPatterns.some(pattern =>
			host === pattern || host.endsWith('.' + pattern)
		)
	);

	const rules: SiteRule[] = [];

	for (const entry of matchingEntries) {
		let rule = loadedRules.get(entry.id);
		if (!rule) {
			try {
				rule = await entry.loader();
				loadedRules.set(entry.id, rule);
			} catch (e) {
				console.error(`[HoverZoom] Failed to load rule: ${entry.id}`, e);
				continue;
			}
		}
		if (rule.matches(host)) {
			rules.push(rule);
		}
	}

	// Sort by priority (higher first)
	rules.sort((a, b) => (b.priority || 0) - (a.priority || 0));
	return rules;
}

/**
 * Get a specific rule by ID (force load if needed)
 */
export async function getRuleById(id: string): Promise<SiteRule | null> {
	if (loadedRules.has(id)) return loadedRules.get(id)!;

	const entry = registry.find(e => e.id === id);
	if (!entry) return null;

	try {
		const rule = await entry.loader();
		loadedRules.set(id, rule);
		return rule;
	} catch {
		return null;
	}
}

/**
 * Check if any rule is available for the given host
 * Fast check without loading rules
 */
export function hasRulesForHost(host: string): boolean {
	return registry.some(entry =>
		entry.hostPatterns.some(pattern =>
			host === pattern || host.endsWith('.' + pattern)
		)
	);
}
