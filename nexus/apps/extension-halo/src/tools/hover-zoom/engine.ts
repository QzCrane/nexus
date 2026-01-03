// goal: Hover zoom anti-hotlink engine
// eff: Uses declarativeNetRequest to remove Referer header

import { HOTLINK_DOMAINS } from './types';

const LOG_TAG = '[HALO:HoverZoom]';
const RULE_ID_START = 10000;

/**
 * Convert domain pattern to match pattern
 */
function domainToPattern(domain: string): string {
	if (domain.startsWith('*.')) {
		return `*://${domain}/*`;
	}
	return `*://${domain}/*`;
}

/**
 * Enable anti-hotlink rules (remove Referer for image requests)
 */
export async function enableAntiHotlink(): Promise<boolean> {
	try {
		const rules: chrome.declarativeNetRequest.Rule[] = HOTLINK_DOMAINS.map((domain, i) => ({
			id: RULE_ID_START + i,
			priority: 1,
			action: {
				type: 'modifyHeaders' as const,
				requestHeaders: [
					{ header: 'Referer', operation: 'remove' as const }
				]
			},
			condition: {
				urlFilter: domainToPattern(domain),
				resourceTypes: ['image' as const, 'media' as const]
			}
		}));

		await chrome.declarativeNetRequest.updateDynamicRules({
			removeRuleIds: rules.map(r => r.id),
			addRules: rules
		});

		console.log(LOG_TAG, `Enabled anti-hotlink for ${rules.length} domains`);
		return true;
	} catch (e) {
		console.error(LOG_TAG, 'Failed to enable anti-hotlink:', e);
		return false;
	}
}

/**
 * Disable anti-hotlink rules
 */
export async function disableAntiHotlink(): Promise<boolean> {
	try {
		const ruleIds = HOTLINK_DOMAINS.map((_, i) => RULE_ID_START + i);
		await chrome.declarativeNetRequest.updateDynamicRules({
			removeRuleIds: ruleIds
		});
		console.log(LOG_TAG, 'Disabled anti-hotlink rules');
		return true;
	} catch (e) {
		console.error(LOG_TAG, 'Failed to disable anti-hotlink:', e);
		return false;
	}
}

/**
 * Check if anti-hotlink is currently enabled
 */
export async function isAntiHotlinkEnabled(): Promise<boolean> {
	try {
		const rules = await chrome.declarativeNetRequest.getDynamicRules();
		return rules.some(r => r.id >= RULE_ID_START && r.id < RULE_ID_START + HOTLINK_DOMAINS.length);
	} catch {
		return false;
	}
}
