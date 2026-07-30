// RuleEngine: Core resolver engine for site-specific rules

import type { SiteRule, Resolver, ResolveContext, RuleResult } from './types';
import { compileRule } from './compiler';

export class RuleEngine {
	private rules = new Map<string, SiteRule[]>();
	private compiledCache = new WeakMap<SiteRule, Resolver>();

	/** Register a rule */
	register(rule: SiteRule) {
		for (const host of rule.hosts) {
			const hostRules = this.rules.get(host) ?? [];
			hostRules.push(rule);
			this.rules.set(host, hostRules);
		}
	}

	/** Resolve URL, supports subdomain matching */
	async resolve(ctx: ResolveContext): Promise<string | RuleResult | null> {
		let hostRules = this.rules.get(ctx.host);

		// If no exact match, try parent domains (e.g., i0.hdslb.com -> hdslb.com)
		if (!hostRules) {
			const parts = ctx.host.split('.');
			for (let i = 1; i < parts.length - 1; i++) {
				const parentHost = parts.slice(i).join('.');
				hostRules = this.rules.get(parentHost);
				if (hostRules) break;
			}
		}

		if (!hostRules) return null;

		for (const rule of hostRules) {
			let matchResult: RegExpMatchArray | null = null;

			// 1. Check Match Condition
			if (rule.match) {
				if (rule.match instanceof RegExp) {
					matchResult = ctx.url.match(rule.match);
					if (!matchResult) continue;
				} else if (typeof rule.match === 'string') {
					if (!ctx.element.matches(rule.match)) continue;
				}
			}

			// 2. Get or Compile Resolver (Lazy Compile)
			let resolver = this.compiledCache.get(rule);
			if (!resolver) {
				resolver = compileRule(rule.resolve);
				this.compiledCache.set(rule, resolver);
			}

			// 3. Execute
			ctx.match = matchResult;
			const result = await resolver(ctx);
			if (result) return result;
		}

		return null;
	}

	/** Get all triggers from registered rules */
	getAllTriggers(): string[] {
		const triggers = new Set<string>();
		for (const rules of this.rules.values()) {
			for (const rule of rules) {
				if (rule.triggers) {
					for (const t of rule.triggers) triggers.add(t);
				}
			}
		}
		return [...triggers];
	}
}
