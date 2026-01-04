import React from 'react';
import { useTranslation } from '../../i18n';
import { CATEGORY_STYLES, styles } from './panel.styles';
import { LEVEL_CONFIG, MECHANISM_ICONS } from './types';
import type { MonitoredService, BackgroundProfile, ImpactLevel, ConsumptionMechanism } from './types';

// Map mechanism to simplified i18n key (no fast/slow distinction)
export const getMechKey = (mech: string): string => {
	if (mech.startsWith('interval')) return 'impact.interval';
	if (mech.startsWith('raf')) return 'impact.raf';
	if (mech === 'event_listener') return 'impact.event';
	if (mech === 'storage_listener') return 'impact.storage';
	if (mech === 'message_listener') return 'impact.message';
	if (mech === 'wheel_listener') return 'impact.wheel';
	if (mech === 'copy_listener') return 'impact.copy';
	if (mech === 'mutation_observer') return 'impact.mutation';
	if (mech === 'service_worker') return 'impact.worker';
	if (mech === 'content_script') return 'impact.content';
	if (mech === 'userscript') return 'impact.userscript';
	return `impact.${mech}`;
};

interface ServiceCardProps {
	item: MonitoredService;
	expandedId: string | null;
	setExpandedId: (id: string | null) => void;
}

export const ServiceCard: React.FC<ServiceCardProps> = ({ item, expandedId, setExpandedId }) => {
	const { t } = useTranslation();
	const isExpanded = expandedId === item.id;
	const mainProfile = item.profiles[0];
	const levelStyle = LEVEL_CONFIG[mainProfile?.level as ImpactLevel || 'idle'];
	const catStyle = CATEGORY_STYLES[item.category] || CATEGORY_STYLES.tool;

	const renderProfile = (p: BackgroundProfile, i: number) => {
		const mechIcon = MECHANISM_ICONS[p.mechanism as ConsumptionMechanism] || '❓';
		const mechKey = getMechKey(p.mechanism);
		const mechName = t(mechKey, { defaultValue: p.mechanism });
		
		return (
			<div key={i} style={styles.detailRow}>
				<span>{mechIcon} {mechName}</span>
				<span style={{ fontFamily: 'monospace' }}>{p.frequency}</span>
			</div>
		);
	};

	return (
		<div 
			style={{ ...styles.card, ...(isExpanded ? styles.cardExpanded : {}) }}
			onClick={() => setExpandedId(isExpanded ? null : item.id)}
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
				{item.category !== 'core' && (
					<div style={{ ...styles.badge, background: catStyle.bg, color: catStyle.color, marginRight: 4 }}>
						{catStyle.label}
					</div>
				)}
				<div style={{ ...styles.badge, background: levelStyle.bg, color: levelStyle.color }}>
					{t(levelStyle.labelKey, { defaultValue: mainProfile?.level?.toUpperCase() })}
				</div>
			</div>

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
