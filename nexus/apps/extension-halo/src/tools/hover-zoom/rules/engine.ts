
import { RuleEngine } from './core';
import { bilibiliRules } from './definitions/bilibili';

// Global singleton rule engine
export const ruleEngine = new RuleEngine();

// Register all built-in rules
// In the future, this can be dynamically populated or lazy-loaded
function registerAllRules() {
	bilibiliRules.forEach(rule => ruleEngine.register(rule));
	console.log(`[HoverZoom:Engine] Registered ${bilibiliRules.length} Bilibili rules`);
}

registerAllRules();
