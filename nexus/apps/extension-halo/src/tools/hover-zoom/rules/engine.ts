// goal: Rule engine singleton with all registered site rules
// eff: Central registry for all hover zoom rules

import { RuleEngine } from './core';
import { bilibiliRules } from './definitions/bilibili';
import { twitterRules } from './definitions/twitter';
import { redditRules } from './definitions/reddit';
import { imgurRules } from './definitions/imgur';

// Global singleton rule engine
export const ruleEngine = new RuleEngine();

// All rule sets in priority order
const ALL_RULES = [
	...bilibiliRules,
	...twitterRules,
	...redditRules,
	...imgurRules
];

// Register all built-in rules
function registerAllRules() {
	ALL_RULES.forEach(rule => ruleEngine.register(rule));
	console.log(`[HoverZoom:Engine] Registered ${ALL_RULES.length} rules from 4 sites`);
}

registerAllRules();
