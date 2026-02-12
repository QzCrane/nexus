// goal: Background Helper hook - manage global background services
// eff: Unified data layer for background helper section

import { useMemo } from 'react';
import { useTranslation } from '../../../i18n';
import { useActiveServices } from '../ActiveServicesContext';
import { BACKGROUND_PROFILES_MAP, ALL_APPS } from '../../../kernel/registry/_generated';
import { classifyBackgroundService } from '../../../kernel/services/background-service-detector';
import { TOOL_PREFS_KEY } from '../../../kernel/registry/tool-registry';
import { safeStorageSet, safeStorageGet } from '../../../kernel/core/safe-storage';
import type { BackgroundProfile } from '../../../system/resource-monitor/types';

export interface BackgroundHelperItem {
	id: string;
	name: string;
	icon: string;
	enabled: boolean;        // User preference (from TOOL_PREFS)
	active: boolean;         // Currently running (from ActiveServices)
	profile: BackgroundProfile;
}

/**
 * Hook for managing background helper tools
 * Only includes GLOBAL background services (activeOnly: false)
 */
export function useBackgroundHelpers() {
	const { t } = useTranslation();
	const { activeServices } = useActiveServices();

	// Filter global background services only
	const globalServiceIds = useMemo(() => {
		return Object.keys(BACKGROUND_PROFILES_MAP).filter(id => {
			const type = classifyBackgroundService(id);
			return type === 'global';
		});
	}, []);

	const helpers = useMemo<BackgroundHelperItem[]>(() => {
		return globalServiceIds.map(id => {
			const profile = BACKGROUND_PROFILES_MAP[id];
			const meta = ALL_APPS.find(app => app.id === id);

			if (!profile || !meta) return null;

			return {
				id,
				name: t(`tools.${id}.name`, { defaultValue: meta.id }),
				icon: meta.icon || '🔧',
				enabled: true, // Will be updated by async load
				active: activeServices.has(id),
				profile
			};
		}).filter(Boolean) as BackgroundHelperItem[];
	}, [globalServiceIds, activeServices, t]);

	// Toggle helper enabled state
	const toggleHelper = async (id: string, enabled: boolean) => {
		const local = await safeStorageGet([TOOL_PREFS_KEY], { [TOOL_PREFS_KEY]: {} }, { area: 'local' });
		const prefs = (local[TOOL_PREFS_KEY] || {}) as Record<string, { enabled?: boolean }>;

		const updated = {
			...prefs,
			[id]: { ...prefs[id], enabled }
		};

		await safeStorageSet({ [TOOL_PREFS_KEY]: updated }, { area: 'local' });
	};

	return {
		helpers,
		activeCount: helpers.filter(h => h.active).length,
		toggleHelper
	};
}
