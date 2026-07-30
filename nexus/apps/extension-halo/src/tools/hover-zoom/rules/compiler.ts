// Rule compiler: converts RuleConfig sugar to Resolver function

import type { Resolver, RuleConfig } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJsonPath(source: unknown, path: string): unknown {
	let current = source;

	for (const key of path.split('.')) {
		if (Array.isArray(current)) {
			if (!/^\d+$/.test(key)) return undefined;
			current = current[Number(key)];
		} else if (isRecord(current)) {
			current = current[key];
		} else {
			return undefined;
		}
	}

	return current;
}

/**
 * Compile declarative RuleConfig to executable Resolver function
 * Uses lazy compile strategy for minimal overhead
 */
export function compileRule(config: RuleConfig): Resolver {
	// Case 0: Already a function
	if (typeof config === 'function') {
		return config;
	}

	// Case 1: Replace pattern
	if ('replace' in config) {
		const [pattern, replacement] = config.replace;
		return async (ctx) => {
			const newUrl = ctx.url.replace(pattern, replacement);
			return newUrl !== ctx.url ? newUrl : null;
		};
	}

	// Case 2: DOM selector
	if ('selector' in config) {
		const { selector, attr = 'src' } = config;
		return async (ctx) => {
			const target = ctx.element.closest(selector) || document.querySelector(selector);
			return target?.getAttribute(attr) || null;
		};
	}

	// Case 3: API call
	if ('api' in config) {
		return async (ctx) => {
			try {
				let apiUrl = config.api;

				// Interpolate $1, $2... from ctx.match
				if (ctx.match) {
					const match = ctx.match;
					apiUrl = apiUrl.replace(/\$(\d+)/g, (_, index) => {
						return match[parseInt(index, 10)] || '';
					});
				}

				if (config.type === 'html') {
					const html = await ctx.fetchHtml(apiUrl);
					if (typeof config.parse === 'function') {
						return config.parse(html);
					}
					return null;
				} else {
					// JSON Mode (Default)
					const data = await ctx.fetchJson(apiUrl);

					if (typeof config.parse === 'function') {
						return config.parse(data);
					}

				if (typeof config.parse === 'string') {
					// Simple JSONPath: "data.items.0.url"
					const parsed = readJsonPath(data, config.parse);
					return typeof parsed === 'string' ? parsed : null;
				}

					return null;
				}
			} catch (e) {
				console.warn(`Rule execution failed:`, e);
				return null;
			}
		};
	}

	return async () => null;
}
