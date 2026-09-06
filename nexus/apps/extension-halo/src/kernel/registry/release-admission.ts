// goal: keep product maturity, physical release admission, and user enablement independent
// inv: missing status is never proof of ready; only the generated release graph authorizes a launcher

import type { PluginMeta } from '../core/tool-registry-types';
import { isReleasePanel, isReleaseScript } from './_generated-release-admission';

export const RELEASE_STATUSES = ['ready', 'beta', 'coming', 'disabled', 'unclassified'] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];
const RELEASE_STATUS_SET = new Set<string>(RELEASE_STATUSES);

export function normalizeReleaseStatus(status: unknown): ReleaseStatus {
	if (status === undefined) return 'unclassified';
	if (typeof status === 'string' && RELEASE_STATUS_SET.has(status)) return status as ReleaseStatus;
	throw new Error(`invalid HALO product maturity: ${String(status)}`);
}

/** Availability is not a maturity claim and cannot be changed by enable/disable. */
export function isLaunchablePlugin(plugin: Pick<PluginMeta, 'id' | 'pluginType' | 'isUserScript'>): boolean {
	if (plugin.isUserScript === true) return plugin.pluginType === 'script' && isReleasePanel('userscripts');
	return plugin.pluginType === 'script' ? isReleaseScript(plugin.id) : isReleasePanel(plugin.id);
}
