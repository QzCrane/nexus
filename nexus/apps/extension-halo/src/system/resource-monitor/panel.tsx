// goal: Resource Monitor panel UI - FULL monitoring with source annotations

import React, { useMemo, useState } from 'react';
import { useTranslation } from '../../i18n';
import { useActiveServices } from '../../components/sidepanel/ActiveServicesContext';
import { BACKGROUND_PROFILES_MAP, BACKGROUND_TOOL_IDS, ALL_APPS } from '../../kernel/registry/_generated';
import { SYSTEM_CORE_CONSUMERS } from './types';
import type { MonitoredService, BackgroundProfile } from './types';
import { styles } from './panel.styles';
import { ServiceCard } from './ServiceCard';

export const ResourceMonitorPanel: React.FC = () => {
	const { t } = useTranslation();
	const { activeServices } = useActiveServices();
	const [expanded, setExpanded] = useState<string | null>(null);

	const toolServices = useMemo<MonitoredService[]>(() => {
		return BACKGROUND_TOOL_IDS.map(id => {
			const profile = BACKGROUND_PROFILES_MAP[id] as BackgroundProfile;
			const meta = ALL_APPS.find(app => app.id === id);
			if (!profile || !meta) return null;
			
			let category: 'tool' | 'system' | 'script' = 'tool';
			if (meta.system) category = 'system';
			else if (meta.toolType === 'script') category = 'script';
			
			return {
				id,
				name: t(`tools.${id}.name`, { defaultValue: id }),
				icon: meta.icon || '🔧',
				active: activeServices.has(id),
				category,
				profiles: [profile]
			};
		}).filter(Boolean) as MonitoredService[];
	}, [activeServices, t]);

	const systemServices = useMemo<MonitoredService[]>(() => {
		return SYSTEM_CORE_CONSUMERS.map(s => ({
			id: s.id, name: t(s.name, { defaultValue: s.name }),
			icon: s.icon, active: true, category: 'core' as const, profiles: s.profiles
		}));
	}, [t]);

	const activeTools = useMemo(() => toolServices.filter(s => s.active), [toolServices]);
	const inactiveTools = useMemo(() => toolServices.filter(s => !s.active), [toolServices]);

	return (
		<div style={styles.container}>
			<div style={styles.section}>
				<div style={styles.header}>
					<span>{t('tools.resource-monitor.sections.system', { defaultValue: 'System Core' })}</span>
					<span style={styles.count}>{systemServices.length}</span>
				</div>
				{systemServices.map(item => <ServiceCard key={item.id} item={item} expandedId={expanded} setExpandedId={setExpanded} />)}
			</div>

			<div style={styles.section}>
				<div style={styles.header}>
					<span>{t('tools.resource-monitor.sections.active', { defaultValue: 'Active' })}</span>
					<span style={styles.count}>{activeTools.length}</span>
				</div>
				{activeTools.length > 0 ? activeTools.map(item => <ServiceCard key={item.id} item={item} expandedId={expanded} setExpandedId={setExpanded} />) : (
					<div style={styles.empty}>{t('tools.resource-monitor.noActive')}</div>
				)}
			</div>

			<div style={styles.section}>
				<div style={styles.header}>
					<span>{t('tools.resource-monitor.sections.inactive', { defaultValue: 'Inactive' })}</span>
					<span style={styles.count}>{inactiveTools.length}</span>
				</div>
				{inactiveTools.length > 0 ? inactiveTools.map(item => <ServiceCard key={item.id} item={item} expandedId={expanded} setExpandedId={setExpanded} />) : (
					<div style={styles.empty}>{t('tools.resource-monitor.noModules')}</div>
				)}
			</div>
		</div>
	);
};
