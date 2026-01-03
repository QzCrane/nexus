// goal: Resource Monitor panel UI - consume BACKGROUND_PROFILES_MAP from registry
// inv: All data comes from manifest.json -> _generated.ts SSOT

import React, { useMemo } from 'react';
import { useTranslation } from '../../i18n';
import { useActiveServices } from '../../components/sidepanel/ActiveServicesContext';
import { BACKGROUND_PROFILES_MAP, BACKGROUND_TOOL_IDS, ALL_APPS } from '../../kernel/registry/_generated';
import { LEVEL_CONFIG, MECHANISM_ICONS } from './types';
import type { MonitoredService, ImpactLevel, ConsumptionMechanism } from './types';

const styles = {
	container: { padding: '16px', display: 'flex', flexDirection: 'column' as const, gap: '20px', height: '100%', overflowY: 'auto' as const },
	section: { display: 'flex', flexDirection: 'column' as const, gap: '10px' },
	header: { fontSize: '13px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.5px', borderBottom: '1px solid var(--halo-border)', paddingBottom: '6px' },
	card: { background: 'var(--halo-bg-secondary)', borderRadius: '10px', padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid var(--halo-border)', gap: '12px' },
	toolInfo: { display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 },
	icon: { fontSize: '20px', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--halo-bg-tertiary)', borderRadius: '8px', flexShrink: 0 },
	meta: { display: 'flex', flexDirection: 'column' as const, gap: '2px', minWidth: 0 },
	name: { fontWeight: 600, fontSize: '13px', color: 'var(--halo-text)', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' },
	desc: { fontSize: '11px', color: 'var(--halo-text-muted)', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' as const },
	badge: { fontSize: '10px', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 },
	empty: { padding: '20px', color: 'var(--halo-text-muted)', fontSize: '13px', textAlign: 'center' as const }
};

export const ResourceMonitorPanel: React.FC = () => {
	const { t } = useTranslation();
	const { activeServices } = useActiveServices();

	// Build service list from SSOT (BACKGROUND_PROFILES_MAP from registry)
	const services = useMemo<MonitoredService[]>(() => {
		return BACKGROUND_TOOL_IDS.map(id => {
			const profile = BACKGROUND_PROFILES_MAP[id];
			const meta = ALL_APPS.find(app => app.id === id);
			if (!profile || !meta) return null;
			
			return {
				id,
				name: t(`tools.${id}.name`, { defaultValue: meta.id }),
				icon: meta.icon || '🔧',
				active: activeServices.has(id),
				mechanism: profile.mechanism as ConsumptionMechanism,
				frequency: profile.frequency,
				level: profile.level as ImpactLevel,
				descriptionKey: profile.descriptionKey,
				activeOnly: profile.activeOnly
			};
		}).filter(Boolean) as MonitoredService[];
	}, [activeServices, t]);

	// Group by active/inactive
	const activeList = useMemo(() => services.filter(s => s.active), [services]);
	const inactiveList = useMemo(() => services.filter(s => !s.active), [services]);

	const renderItem = (item: MonitoredService) => {
		const levelStyle = LEVEL_CONFIG[item.level];
		const mechIcon = MECHANISM_ICONS[item.mechanism] || '❓';

		return (
			<div key={item.id} style={styles.card}>
				<div style={styles.toolInfo}>
					<div style={styles.icon}>{item.icon}</div>
					<div style={styles.meta}>
						<div style={styles.name}>{item.name}</div>
						<div style={styles.desc}>
							<span>{mechIcon}</span>
							<span>{t(item.descriptionKey, { defaultValue: item.mechanism })}</span>
							<span style={{ opacity: 0.6 }}>•</span>
							<span style={{ fontFamily: 'monospace', fontSize: '10px' }}>{item.frequency}</span>
							{item.activeOnly && <span style={{ opacity: 0.5 }}>(panel)</span>}
						</div>
					</div>
				</div>
				<div style={{ ...styles.badge, background: levelStyle.bg, color: levelStyle.color }}>
					{levelStyle.label}
				</div>
			</div>
		);
	};

	return (
		<div style={styles.container}>
			{/* Active */}
			<div style={styles.section}>
				<div style={styles.header}>
					{t('tools.resource-monitor.sections.active', { defaultValue: 'Active' })} ({activeList.length})
				</div>
				{activeList.length > 0 ? activeList.map(renderItem) : (
					<div style={styles.empty}>{t('tools.resource-monitor.noActive', { defaultValue: 'No active services' })}</div>
				)}
			</div>

			{/* Inactive */}
			<div style={styles.section}>
				<div style={styles.header}>
					{t('tools.resource-monitor.sections.inactive', { defaultValue: 'Inactive' })} ({inactiveList.length})
				</div>
				{inactiveList.length > 0 ? inactiveList.map(renderItem) : (
					<div style={styles.empty}>{t('tools.resource-monitor.noModules', { defaultValue: 'No background services' })}</div>
				)}
			</div>
		</div>
	);
};
