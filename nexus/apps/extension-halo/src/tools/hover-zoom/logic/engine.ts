// goal: Hover zoom anti-hotlink engine
// eff: Uses declarativeNetRequest to remove Referer header

import { HOTLINK_DOMAINS } from '../types';

const LOG_TAG = '[HALO:HoverZoom]';
export const RULE_ID_START = 10_000;
const RULE_ID_END = 10_999;

export interface AntiHotlinkReceipt {
	desired: boolean;
	active: boolean;
	changed: boolean;
	error?: string;
}

/**
 * Convert domain pattern to match pattern
 */
function domainToPattern(domain: string): string {
	if (domain.startsWith('*.')) {
		return `*://${domain}/*`;
	}
	return `*://${domain}/*`;
}

export function createAntiHotlinkRules(): chrome.declarativeNetRequest.Rule[] {
	return HOTLINK_DOMAINS.map((domain, i) => ({
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
}

function isOwnedRule(rule: chrome.declarativeNetRequest.Rule): boolean {
	return rule.id >= RULE_ID_START && rule.id <= RULE_ID_END;
}

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.entries(value as Record<string, unknown>)
			.filter(([, item]) => item !== undefined)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}

function sameRule(
	actual: chrome.declarativeNetRequest.Rule,
	expected: chrome.declarativeNetRequest.Rule,
): boolean {
	return canonical(actual) === canonical(expected);
}

export function isExactAntiHotlinkRuleSet(
	rules: readonly chrome.declarativeNetRequest.Rule[],
): boolean {
	const owned = rules.filter(isOwnedRule).sort((left, right) => left.id - right.id);
	const expected = createAntiHotlinkRules();
	return owned.length === expected.length
		&& expected.every((rule, index) => sameRule(owned[index] as chrome.declarativeNetRequest.Rule, rule));
}

/** Background-only desired/physical reconciliation authority. */
export async function reconcileAntiHotlinkRules(desired: boolean): Promise<AntiHotlinkReceipt> {
	try {
		const before = await chrome.declarativeNetRequest.getDynamicRules();
		const ownedIds = before.filter(isOwnedRule).map((rule) => rule.id);
		const alreadyActive = isExactAntiHotlinkRuleSet(before);
		if ((desired && alreadyActive) || (!desired && ownedIds.length === 0)) {
			return { desired, active: desired ? alreadyActive : false, changed: false };
		}

		await chrome.declarativeNetRequest.updateDynamicRules({
			removeRuleIds: ownedIds,
			...(desired ? { addRules: createAntiHotlinkRules() } : {}),
		});
		const after = await chrome.declarativeNetRequest.getDynamicRules();
		const active = isExactAntiHotlinkRuleSet(after);
		const converged = desired ? active : !after.some(isOwnedRule);
		if (!converged) {
			return {
				desired,
				active,
				changed: true,
				error: 'physical_rule_readback_mismatch',
			};
		}
		console.log(LOG_TAG, desired ? 'Anti-hotlink rules reconciled' : 'Anti-hotlink rules removed');
		return { desired, active, changed: true };
	} catch (error: unknown) {
		console.error(LOG_TAG, 'Anti-hotlink reconciliation failed:', error);
		return {
			desired,
			active: false,
			changed: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
