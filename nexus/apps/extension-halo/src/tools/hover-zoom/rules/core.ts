// 1. 核心定义 (Core Definitions)

export interface ResolveContext {
	url: string;           // Resource URL (src/href)
	element: Element;      // Trigger element
	host: string;          // Current hostname
	match: RegExpMatchArray | null; // Match result from Rule.match (if RegExp)

	// Utils
	fetchHtml: (url: string) => Promise<string>;
	fetchJson: <T = any>(url: string, headers?: Record<string, string>) => Promise<T>;
	getCookie: (name: string) => string;
}


export interface RuleResult {
	url: string;           // 媒体 URL
	audioUrl?: string;     // 音频 URL (用于 DASH)
	headers?: Record<string, string>; // 请求头 (如 Referer)
	fallbackUrl?: string;  // 降级 URL
	type?: 'image' | 'video' | 'audio'; // 媒体类型
	caption?: string;      // 媒体标题/描述
}

// 核心类型：解析器函数
// 返回 null 表示无结果；返回 string 是 { url: string } 的简写
export type Resolver = (ctx: ResolveContext) => Promise<string | RuleResult | null>;


// 2. 语法糖定义 (Syntax Sugars)

// 声明式配置 - 会在运行时被"编译"为 Resolver 函数
export type RuleConfig =
	| Resolver                                    // 0. 直接函数 (最高自由度)
	| { replace: [RegExp | string, string] }     // 1. 正则替换 (覆盖 80% 场景)
	| { selector: string; attr?: string }        // 2. DOM 提取 (覆盖 10% 场景)
	| {
		api: string;                             // 3. API Call (Cover 5% cases)
		type?: 'json' | 'html';                  // default: json
		// Support simple string path "data.url" or custom extractor function
		parse?: string | ((data: any) => string);
	}
	;

// 完整的规则定义
export interface SiteRule {
	id: string;               // 规则唯一标识 (e.g. 'amazon', 'bilibili')
	name?: string;            // 人读名称
	hosts: string[];          // 匹配的主机名列表
	match?: RegExp | string;  // (可选) 触发条件：URL正则 或 CSS选择器

	resolve: RuleConfig;      // 核心解析逻辑
}

// 3. 编译器 (Compiler)

/**
 * 将声明式的 RuleConfig 编译为可执行的 Resolver 函数
 * 采用 Lazy Compile 策略，开销极低
 */
export function compileRule(config: RuleConfig): Resolver {
	// Case 0: 已经是函数，直接返回
	if (typeof config === 'function') {
		return config;
	}

	// Case 1: 正则替换
	if ('replace' in config) {
		const [pattern, replacement] = config.replace;
		return async (ctx) => {
			const newUrl = ctx.url.replace(pattern, replacement);
			// 如果没有变化，说明不匹配，返回 null
			return newUrl !== ctx.url ? newUrl : null;
		};
	}

	// Case 2: DOM 提取
	if ('selector' in config) {
		const { selector, attr = 'src' } = config;
		return async (ctx) => {
			// 优先在元素内部找，找不到再全局找
			const target = ctx.element.closest(selector) || document.querySelector(selector);
			return target?.getAttribute(attr) || null;
		};
	}

	// Case 3: API 调用
	// Case 3: API Call (Syntax Sugar)
	if ('api' in config) {
		return async (ctx) => {
			try {
				let apiUrl = config.api;

				// Interpolate $1, $2... from ctx.match
				if (ctx.match) {
					apiUrl = apiUrl.replace(/\$(\d+)/g, (_, index) => {
						return ctx.match![parseInt(index)] || '';
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
						return config.parse.split('.').reduce((obj, key) => obj?.[key], data) as string;
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

// ==========================================
// 4. 引擎核心 (Engine Core)
// ==========================================

export class RuleEngine {
	private rules = new Map<string, SiteRule[]>();
	private compiledCache = new WeakMap<SiteRule, Resolver>();

	/**
	 * 注册规则
	 */
	register(rule: SiteRule) {
		for (const host of rule.hosts) {
			if (!this.rules.has(host)) {
				this.rules.set(host, []);
			}
			this.rules.get(host)!.push(rule);
		}
	}

	/**
	 * 解析 URL
	 */
	async resolve(ctx: ResolveContext): Promise<string | RuleResult | null> {
		const hostRules = this.rules.get(ctx.host);
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

			// 3. Update Context & Execute
			// We create a new context proxy or mutate gently if allowed.
			// Here we just assign match since ctx is created per request in rule-resolver.
			ctx.match = matchResult;

			const result = await resolver(ctx);
			if (result) return result;
		}

		return null;
	}
}
