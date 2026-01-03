// goal: Resource Monitor panel UI - FULL monitoring with source annotations
// inv: Display tools, scripts, AND system core consumers with source file:line

import React, { useMemo, useState } from 'react';
import { useTranslation } from '../../i18n';
import { useActiveServices } from '../../components/sidepanel/ActiveServicesContext';
import { BACKGROUND_PROFILES_MAP, BACKGROUND_TOOL_IDS, ALL_APPS } from '../../kernel/registry/_generated';
import { LEVEL_CONFIG, MECHANISM_ICONS, SYSTEM_CORE_CONSUMERS } from './types';
import type { MonitoredService, BackgroundProfile, ImpactLevel, ConsumptionMechanism } from './types';

const styles = {
	container: { padding: '16px', display: 'flex', flexDirection: 'column' as const, gap: '16px', height: '100%', overflowY: 'auto' as const },
	section: { display: 'flex', flexDirection: 'column' as const, gap: '8px' },
	header: { fontSize: '12px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.5px', borderBottom: '1px solid var(--halo-border)', paddingBottom: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
	card: { background: 'var(--halo-bg-secondary)', borderRadius: '10px', padding: '10px 12px', border: '1px solid var(--halo-border)', cursor: 'pointer', transition: 'all 0.15s' },
	cardExpanded: { background: 'var(--halo-bg-tertiary)' },
	toolRow: { display: 'flex', alignItems: 'center', gap: '10px' },
	icon: { fontSize: '18px', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--halo-bg-tertiary)', borderRadius: '6px', flexShrink: 0 },
	meta: { display: 'flex', flexDirection: 'column' as const, gap: '1px', flex: 1, minWidth: 0 },
	name: { fontWeight: 600, fontSize: '13px', color: 'var(--halo-text)', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' },
	mechanisms: { fontSize: '10px', color: 'var(--halo-text-muted)', display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' as const },
	badge: { fontSize: '9px', padding: '2px 5px', borderRadius: '3px', fontWeight: 600 },
	detail: { marginTop: '8px', padding: '8px', background: 'var(--halo-bg)', borderRadius: '6px', fontSize: '10px', fontFamily: 'monospace', color: 'var(--halo-text-secondary)' },
	detailRow: { display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: '1px solid var(--halo-border)' },
	empty: { padding: '16px', color: 'var(--halo-text-muted)', fontSize: '12px', textAlign: 'center' as const },
	count: { fontSize: '11px', color: 'var(--halo-accent)' }
};

export const ResourceMonitorPanel: React.FC = () => {
	const { t } = useTranslation();
	const { activeServices } = useActiveServices();
	const [expanded, setExpanded] = useState<string | null>(null);

	// Build tool service list from BACKGROUND_PROFILES_MAP
	const toolServices = useMemo<MonitoredService[]>(() => {
		return BACKGROUND_TOOL_IDS.map(id => {
			const profile = BACKGROUND_PROFILES_MAP[id] as BackgroundProfile;
			const meta = ALL_APPS.find(app => app.id === id);
			if (!profile || !meta) return null;
			
			return {
				id,
				name: t(`tools.${id}.name`, { defaultValue: id }),
				icon: meta.icon || '🔧',
				active: activeServices.has(id),
				category: meta.system ? 'system' : 'tool',
				profiles: [profile]
			};
		}).filter(Boolean) as MonitoredService[];
	}, [activeServices, t]);

	// System core consumers (always active)
	const systemServices = useMemo<MonitoredService[]>(() => {
		return SYSTEM_CORE_CONSUMERS.map(s => ({
			id: s.id,
			name: t(s.name, { defaultValue: s.name }),
			icon: s.icon,
			active: true,
			category: 'core' as const,
			profiles: s.profiles
		}));
	}, [t]);

	// Group tools by active/inactive
	const activeTools = useMemo(() => toolServices.filter(s => s.active), [toolServices]);
	const inactiveTools = useMemo(() => toolServices.filter(s => !s.active), [toolServices]);

	const renderProfile = (p: BackgroundProfile, i: number) => {
		const levelStyle = LEVEL_CONFIG[p.level as ImpactLevel];
		const mechIcon = MECHANISM_ICONS[p.mechanism as ConsumptionMechanism] || '❓';
		
		return (
			<div key={i} style={styles.detailRow}>
				<span>{mechIcon} {t(p.descriptionKey, { defaultValue: p.mechanism })}</span>
				<span>{p.frequency}</span>
			</div>
		);
	};

	const renderItem = (item: MonitoredService) => {
		const isExpanded = expanded === item.id;
		const mainProfile = item.profiles[0];
		const levelStyle = LEVEL_CONFIG[mainProfile?.level as ImpactLevel || 'idle'];

		return (
			<div 
				key={item.id} 
				style={{ ...styles.card, ...(isExpanded ? styles.cardExpanded : {}) }}
				onClick={() => setExpanded(isExpanded ? null : item.id)}
			>
				<div style={styles.toolRow}>
					<div style={styles.icon}>{item.icon}</div>
					<div style={styles.meta}>
						<div style={styles.name}>{item.name}</div>
						<div style={styles.mechanisms}>
							{item.profiles.map((p, i) => (
								<span key={i}>
									{MECHANISM_ICONS[p.mechanism as ConsumptionMechanism] || '❓'}
									<span style={{ marginLeft: 2, fontFamily: 'monospace' }}>{p.frequency}</span>
									{i < item.profiles.length - 1 && <span style={{ opacity: 0.4 }}> | </span>}
								</span>
							))}
						</div>
					</div>
					<div style={{ ...styles.badge, background: levelStyle.bg, color: levelStyle.color }}>
						{t(levelStyle.labelKey, { defaultValue: mainProfile?.level?.toUpperCase() })}
					</div>
				</div>

				{/* Expanded detail with source annotation */}
				{isExpanded && (
					<div style={styles.detail}>
						{item.profiles.map((p, i) => (
							<div key={i} style={{ marginBottom: i < item.profiles.length - 1 ? 8 : 0 }}>
								{renderProfile(p, i)}
								<div style={{ opacity: 0.6, marginTop: 2 }}>
									📄 {p.sourceFile}:{p.sourceLine}
									{p.sourceDetail && <><br/>💡 {p.sourceDetail}</>}
								</div>
							</div>
						))}
					</div>
				)}
			</div>
		);
	};

	return (
		<div style={styles.container}>
			{/* System Core (always running) */}
			<div style={styles.section}>
				<div style={styles.header}>
					<span>{t('tools.resource-monitor.sections.system', { defaultValue: 'System Core' })}</span>
					<span style={styles.count}>{systemServices.length}</span>
				</div>
				{systemServices.map(renderItem)}
			</div>

			{/* Active Tools */}
			<div style={styles.section}>
				<div style={styles.header}>
					<span>{t('tools.resource-monitor.sections.active', { defaultValue: 'Active' })}</span>
					<span style={styles.count}>{activeTools.length}</span>
				</div>
				{activeTools.length > 0 ? activeTools.map(renderItem) : (
					<div style={styles.empty}>{t('tools.resource-monitor.noActive')}</div>
				)}
			</div>

			{/* Inactive Tools */}
			<div style={styles.section}>
				<div style={styles.header}>
					<span>{t('tools.resource-monitor.sections.inactive', { defaultValue: 'Inactive' })}</span>
					<span style={styles.count}>{inactiveTools.length}</span>
				</div>
				{inactiveTools.length > 0 ? inactiveTools.map(renderItem) : (
					<div style={styles.empty}>{t('tools.resource-monitor.noModules')}</div>
				)}
			</div>
		</div>
	);
};
