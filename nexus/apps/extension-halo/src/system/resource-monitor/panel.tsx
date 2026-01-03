import React from 'react';
import { useTranslation } from '../../i18n';
import { useActiveServices } from '../../components/sidepanel/ActiveServicesContext';
import { getToolMeta } from '../../kernel';

const styles = {
	container: {
		padding: '16px',
		display: 'flex',
		flexDirection: 'column' as const,
		gap: '24px',
		height: '100%',
		overflowY: 'auto' as const,
	},
	section: {
		display: 'flex',
		flexDirection: 'column' as const,
		gap: '12px',
	},
	header: {
		fontSize: '14px',
		fontWeight: 600,
		color: 'var(--halo-text-muted)',
		textTransform: 'uppercase' as const,
		letterSpacing: '0.5px',
		borderBottom: '1px solid var(--halo-border)',
		paddingBottom: '8px',
	},
	card: {
		background: 'var(--halo-bg-secondary)',
		borderRadius: '12px',
		padding: '16px',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'space-between',
		border: '1px solid var(--halo-border)',
	},
	toolInfo: {
		display: 'flex',
		alignItems: 'center',
		gap: '12px',
	},
	icon: {
		fontSize: '24px',
		width: '40px',
		height: '40px',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		background: 'var(--halo-bg-tertiary)',
		borderRadius: '10px',
	},
	meta: {
		display: 'flex',
		flexDirection: 'column' as const,
		gap: '2px',
	},
	name: {
		fontWeight: 600,
		fontSize: '14px',
		color: 'var(--halo-text)',
	},
	desc: {
		fontSize: '12px',
		color: 'var(--halo-text-muted)',
	},
	status: {
		fontSize: '12px',
		fontWeight: 600,
		padding: '4px 8px',
		borderRadius: '6px',
		display: 'flex',
		alignItems: 'center',
		gap: '6px',
	},
	statusActive: {
		background: 'rgba(34, 197, 94, 0.1)',
		color: '#22c55e',
	},
	statusInactive: {
		background: 'var(--halo-bg-tertiary)',
		color: 'var(--halo-text-muted)',
	},
	dot: {
		width: '6px',
		height: '6px',
		borderRadius: '50%',
		background: 'currentColor',
	}
};

export const ResourceMonitorPanel: React.FC = () => {
	const { t } = useTranslation();
	const { activeServices, bgToolIds } = useActiveServices();

	const services = bgToolIds.map(id => {
		const meta = getToolMeta(id);
		if (!meta) return null;
		
		return {
			id,
			meta,
			active: activeServices.has(id),
			type: meta.toolType === 'script' ? 'script' : 'service'
		};
	}).filter(Boolean);

	const activeList = services.filter(s => s?.active);
	const inactiveList = services.filter(s => !s?.active);

	// Get tools with listener permissions but not in bgToolIds (e.g. webRequest)
	// This is a bit hypothetical for now as we don't have a direct map, 
	// but we can list active services as "Running"
	
	const renderItem = (item: NonNullable<typeof services[0]>) => {
		const nameKey = `tools.${item.meta.id}.name`;
		const name = t(nameKey) === nameKey ? (item.meta.name || item.id) : t(nameKey);
		const typeLabel = item.type === 'script' ? t('tools.resource-monitor.types.script') : t('tools.resource-monitor.types.service');
		
		return (
			<div key={item.id} style={styles.card}>
				<div style={styles.toolInfo}>
					<div style={styles.icon}>{item.meta.icon}</div>
					<div style={styles.meta}>
						<div style={styles.name}>{name}</div>
						<div style={styles.desc}>{typeLabel} • v{item.meta.version || '1.0.0'}</div>
					</div>
				</div>
				<div style={{
					...styles.status,
					...(item.active ? styles.statusActive : styles.statusInactive)
				}}>
					<div style={styles.dot} />
					{item.active ? t('tools.resource-monitor.status.running') : t('tools.resource-monitor.status.stopped')}
				</div>
			</div>
		);
	};

	return (
		<div style={styles.container}>
			{activeList.length > 0 && (
				<div style={styles.section}>
					<div style={styles.header}>
						{t('tools.resource-monitor.sections.active')} ({activeList.length})
					</div>
					{activeList.map(item => item && renderItem(item))}
				</div>
			)}

			<div style={styles.section}>
				<div style={styles.header}>
					{t('tools.resource-monitor.sections.inactive')} ({inactiveList.length})
				</div>
				{inactiveList.length > 0 ? (
					inactiveList.map(item => item && renderItem(item))
				) : (
					<div style={{ padding: '12px', color: 'var(--halo-text-muted)', fontSize: '13px', textAlign: 'center' }}>
						{t('moduleStorePanel.noModules')}
					</div>
				)}
			</div>
		</div>
	);
};
