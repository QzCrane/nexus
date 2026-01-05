// goal: Module item component for store list with enhanced script visuals
// eff: Render individual module status and actions with rich color coding

import React from 'react';
import { useTranslation } from '../../i18n';
import { formatModuleSize, type ModuleMeta } from '../../kernel';

// Enhanced styles with script-specific colors
const styles = {
	item: {
		display: 'flex', alignItems: 'center', gap: '8px', padding: '12px',
		background: 'var(--halo-bg-secondary)', borderRadius: '12px',
		border: '1px solid var(--halo-border)', transition: 'all 0.2s',
		minHeight: '64px', position: 'relative' as const, overflow: 'hidden' as const,
	},
	// Accent bar for scripts/apps
	accentBar: {
		position: 'absolute' as const,
		top: 0, left: 0, bottom: 0,
		width: '4px',
	},
	icon: { 
		fontSize: '24px', minWidth: '40px', textAlign: 'center' as const, 
		borderRadius: '10px', padding: '8px', height: '40px', width: '40px',
		display: 'flex', alignItems: 'center', justifyContent: 'center',
		flexShrink: 0,
	},
	iconDefault: {
		background: 'var(--halo-bg-tertiary)',
	},
	iconJS: {
		background: 'linear-gradient(135deg, #FFD700, #FFA500)',
		boxShadow: '0 2px 8px rgba(255, 165, 0, 0.2)',
	},
	iconCSS: {
		background: 'linear-gradient(135deg, #2196F3, #1976D2)',
		boxShadow: '0 2px 8px rgba(33, 150, 243, 0.2)',
	},
	iconSystem: {
		background: 'linear-gradient(135deg, #9C27B0, #7B1FA2)',
		boxShadow: '0 2px 8px rgba(156, 39, 176, 0.2)',
	},
	info: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' as const, gap: '4px' },
	name: { fontSize: '14px', fontWeight: 700, color: 'var(--halo-text)', display: 'flex', alignItems: 'center', gap: '8px' },
	desc: { fontSize: '12px', color: 'var(--halo-text-muted)', lineHeight: '1.4', overflow: 'hidden' as const, whiteSpace: 'nowrap' as const, textOverflow: 'ellipsis' as const },
	meta: { fontSize: '11px', color: 'var(--halo-text-muted)', display: 'flex', gap: '8px', alignItems: 'center' },
	index: { fontSize: '10px', fontWeight: 500, color: 'var(--halo-text-muted)', minWidth: '12px', textAlign: 'center' as const },
	
	btn: {
		padding: '6px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
		cursor: 'pointer', border: 'none', transition: 'all 0.15s', minWidth: '80px',
	},
	btnInstall: { background: 'var(--halo-accent)', color: '#fff' },
	btnUninstall: { background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-muted)', border: '1px solid var(--halo-border)' },
	btnDownloading: { background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-muted)', cursor: 'wait' },
	btnCore: { background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-muted)', fontSize: '10px', cursor: 'default', padding: '4px 8px', borderRadius: '4px' },
	
	badge: { fontSize: '10px', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 },
	badgeCore: { background: 'var(--halo-accent-alpha)', color: 'var(--halo-accent)' },
	badgeNew: { background: 'rgba(34, 197, 94, 0.2)', color: '#22c55e' },
	badgeScript: { background: 'rgba(255, 215, 0, 0.15)', color: '#FFD700' },
	badgeCSS: { background: 'rgba(33, 150, 243, 0.15)', color: '#64B5F6' },
	badgeSystem: { background: 'rgba(156, 39, 176, 0.15)', color: '#BA68C8' },
	badgeType: { marginLeft: '8px', fontSize: '10px', padding: '2px 8px', borderRadius: '10px', background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-secondary)', fontWeight: 500, border: '1px solid var(--halo-border)' },
};

interface ModuleItemProps {
	module: ModuleMeta;
	index: number;
	status: 'installed' | 'available' | 'downloading' | 'updating' | 'error';
	isCore: boolean;
	showTypeLabel?: boolean;
	isUserScript?: boolean;
	onInstall: () => void;
	onUninstall: () => void;
}

export const ModuleItem: React.FC<ModuleItemProps> = ({ module, index, status, isCore, showTypeLabel = true, isUserScript = false, onInstall, onUninstall }) => {
	const { t } = useTranslation();
	const isInstalled = status === 'installed';
	const isDownloading = status === 'downloading' || status === 'updating';

	const nameKey = `tools.${module.id}.name`;
	const descKey = `tools.${module.id}.desc`;
	const nameTranslation = t(nameKey);
	const descTranslation = t(descKey);
	
	const displayName = String(nameTranslation) === nameKey ? (module.name || module.id) : String(nameTranslation);
	const displayDesc = String(descTranslation) === descKey ? (module.description || '') : String(descTranslation);

	// Determine module type and colors
	const isScript = module.pluginType === 'script';
	const isCSS = isScript && module.script?.type === 'css';
	const isSystem = module.pluginType === 'system';

	// Get accent color based on type
	const getAccentColor = () => {
		if (isSystem) return '#9C27B0';
		if (isScript && isCSS) return '#2196F3';
		if (isScript) return '#FFD700';
		return 'var(--halo-accent)';
	};

	// Get icon style based on type
	const getIconStyle = () => {
		if (isSystem) return styles.iconSystem;
		if (isScript && isCSS) return styles.iconCSS;
		if (isScript) return styles.iconJS;
		return styles.iconDefault;
	};

	// Get type badge style
	const getTypeBadgeStyle = () => {
		if (isSystem) return styles.badgeSystem;
		if (isScript && isCSS) return styles.badgeCSS;
		if (isScript) return styles.badgeScript;
		return {};
	};

	const typeLabel = isSystem ? t('moduleStorePanel.filters.system') 
		: isScript ? (isCSS ? 'CSS' : 'JS')
		: t('moduleStorePanel.filters.app');

	return (
		<div style={styles.item}>
			{/* Left accent bar for scripts */}
			{(isScript || isSystem) && (
				<div style={{
					...styles.accentBar,
					background: getAccentColor(),
					opacity: 0.8,
				}} />
			)}

			<span style={styles.index}>{index}</span>
			
			{/* Icon with type-based gradient */}
			<span style={{
				...styles.icon,
				...getIconStyle(),
			}}>
				{module.icon}
			</span>

			<div style={styles.info}>
				<div style={styles.name}>
					{displayName}
					{showTypeLabel && (
						<span style={{
							...styles.badgeType,
							...getTypeBadgeStyle(),
						}}>
							{typeLabel}
						</span>
					)}
					{!isCore && !isInstalled && <span style={{ ...styles.badge, ...styles.badgeNew }}>{t('moduleStorePanel.new')}</span>}
				</div>
				<div style={styles.desc} title={displayDesc}>{displayDesc}</div>
			</div>

			<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
				{isUserScript ? (
					<span style={{ ...styles.btnCore, background: 'rgba(107, 114, 128, 0.15)', color: '#6b7280' }}>
						🔒 {t('common.readOnly')}
					</span>
				) : isCore ? (
					<span style={styles.btnCore}>{t('moduleStorePanel.builtIn')}</span>
				) : isDownloading ? (
					<button style={{ ...styles.btn, ...styles.btnDownloading }} disabled>
						⏳ {status === 'updating' ? t('moduleStorePanel.updating') : t('moduleStorePanel.installing')}
					</button>
				) : isInstalled ? (
					<button style={{ ...styles.btn, ...styles.btnUninstall }} onClick={onUninstall}>
						{t('moduleStorePanel.uninstall')}
					</button>
				) : (
					<button style={{ ...styles.btn, ...styles.btnInstall }} onClick={onInstall}>
						{t('moduleStorePanel.install')}
					</button>
				)}
				<div style={styles.meta}>
					<span>v{module.version || '0.0.0'}</span>
					<span>•</span>
					<span>{formatModuleSize(module.size || 0)}</span>
				</div>
			</div>
		</div>
	);
};
