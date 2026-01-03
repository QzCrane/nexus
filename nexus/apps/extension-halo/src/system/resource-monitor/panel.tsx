// goal: Resource Monitor panel UI - ultra-precise CPU consumption dashboard
// inv: Group by mechanism, show impact scores, sortable

import React, { useMemo } from 'react';
import { useTranslation } from '../../i18n';
import { useActiveServices } from '../../components/sidepanel/ActiveServicesContext';
import { getToolMeta } from '../../kernel';
import { analyzeImpact, analyzeUserScript } from './monitor';
import { calculateImpactScore } from './types';
import type { MonitoredService, ImpactLevel, ConsumptionMechanism } from './types';

// Styles extracted for maintainability
const styles = {
	container: { padding: '16px', display: 'flex', flexDirection: 'column' as const, gap: '20px', height: '100%', overflowY: 'auto' as const },
	section: { display: 'flex', flexDirection: 'column' as const, gap: '10px' },
	header: { fontSize: '13px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.5px', borderBottom: '1px solid var(--halo-border)', paddingBottom: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
	card: { background: 'var(--halo-bg-secondary)', borderRadius: '10px', padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid var(--halo-border)', gap: '12px' },
	toolInfo: { display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 },
	icon: { fontSize: '20px', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--halo-bg-tertiary)', borderRadius: '8px', flexShrink: 0 },
	meta: { display: 'flex', flexDirection: 'column' as const, gap: '2px', minWidth: 0 },
	name: { fontWeight: 600, fontSize: '13px', color: 'var(--halo-text)', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' },
	desc: { fontSize: '11px', color: 'var(--halo-text-muted)', display: 'flex', alignItems: 'center', gap: '6px' },
	badge: { fontSize: '10px', padding: '2px 6px', borderRadius: '4px', fontWeight: 500 },
	score: { fontSize: '11px', fontWeight: 600, padding: '4px 8px', borderRadius: '6px', textAlign: 'center' as const, minWidth: '36px' },
	empty: { padding: '20px', color: 'var(--halo-text-muted)', fontSize: '13px', textAlign: 'center' as const }
};

// Level colors
const LEVEL_COLORS: Record<ImpactLevel, { bg: string; color: string }> = {
	critical: { bg: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' },
	high: { bg: 'rgba(249, 115, 22, 0.15)', color: '#f97316' },
	medium: { bg: 'rgba(234, 179, 8, 0.15)', color: '#eab308' },
	low: { bg: 'rgba(34, 197, 94, 0.1)', color: '#22c55e' },
	idle: { bg: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-muted)' }
};

// Mechanism display names
const MECHANISM_ICONS: Record<ConsumptionMechanism, string> = {
	interval_fast: '⏱️', interval_slow: '🕐', raf_active: '🎬', raf_idle: '💤',
	event_listener: '👂', storage_listener: '💾', message_listener: '📨',
	mutation_observer: '👁️', service_worker: '⚙️', content_script: '📜', userscript: '🔧'
};

export const ResourceMonitorPanel: React.FC = () => {
	const { t } = useTranslation();
	const { activeServices, bgToolIds } = useActiveServices();

	// Build service list with impact analysis
	const services = useMemo<MonitoredService[]>(() => {
		return bgToolIds.map(id => {
			const meta = getToolMeta(id);
			if (!meta) return null;
			
			const impact = analyzeImpact(meta);
			const isActive = activeServices.has(id);
			
			return {
				id,
				name: t(`tools.${id}.name`, { defaultValue: meta.name || id }),
				icon: meta.icon || '🔧',
				active: isActive,
				toolType: meta.toolType === 'script' ? 'script' : 'service',
				impact,
				source: 'builtin',
				_score: calculateImpactScore(impact, isActive)
			};
		}).filter(Boolean) as (MonitoredService & { _score: number })[];
	}, [bgToolIds, activeServices, t]);

	// Group by active/inactive, sort by impact score
	const activeList = useMemo(() => 
		services.filter(s => s.active).sort((a, b) => (b as any)._score - (a as any)._score), 
		[services]
	);
	const inactiveList = useMemo(() => 
		services.filter(s => !s.active).sort((a, b) => (b as any)._score - (a as any)._score), 
		[services]
	);

	// Total estimated CPU
	const totalCpu = useMemo(() => 
		activeList.reduce((sum, s) => sum + (s.impact.estimatedCpuMs || 0), 0),
		[activeList]
	);

	const renderItem = (item: MonitoredService) => {
		const levelStyle = LEVEL_COLORS[item.impact.level];
		const mechIcon = MECHANISM_ICONS[item.impact.mechanism] || '❓';
		const score = calculateImpactScore(item.impact, item.active);

		return (
			<div key={item.id} style={styles.card}>
				<div style={styles.toolInfo}>
					<div style={styles.icon}>{item.icon}</div>
					<div style={styles.meta}>
						<div style={styles.name}>{item.name}</div>
						<div style={styles.desc}>
							<span>{mechIcon}</span>
							<span>{t(item.impact.descriptionKey, { defaultValue: item.impact.mechanism })}</span>
							{item.impact.frequency && <span style={{ opacity: 0.7 }}>• {item.impact.frequency}</span>}
						</div>
					</div>
				</div>
				<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
					{item.active && item.impact.estimatedCpuMs !== undefined && item.impact.estimatedCpuMs > 0 && (
						<div style={{ ...styles.badge, ...levelStyle }}>
							~{item.impact.estimatedCpuMs}ms/s
						</div>
					)}
					<div style={{ ...styles.score, background: levelStyle.bg, color: levelStyle.color }}>
						{score}
					</div>
				</div>
			</div>
		);
	};

	return (
		<div style={styles.container}>
			{/* Active Services */}
			<div style={styles.section}>
				<div style={styles.header}>
					<span>{t('tools.resource-monitor.sections.active', { defaultValue: 'Active Services' })} ({activeList.length})</span>
					{totalCpu > 0 && <span style={{ fontSize: '11px', color: LEVEL_COLORS.medium.color }}>~{totalCpu}ms/s CPU</span>}
				</div>
				{activeList.length > 0 ? activeList.map(renderItem) : (
					<div style={styles.empty}>{t('tools.resource-monitor.noActive', { defaultValue: 'No active services' })}</div>
				)}
			</div>

			{/* Inactive Services */}
			<div style={styles.section}>
				<div style={styles.header}>
					<span>{t('tools.resource-monitor.sections.inactive', { defaultValue: 'Inactive' })} ({inactiveList.length})</span>
				</div>
				{inactiveList.length > 0 ? inactiveList.map(renderItem) : (
					<div style={styles.empty}>{t('tools.resource-monitor.noModules', { defaultValue: 'No background services' })}</div>
				)}
			</div>
		</div>
	);
};
