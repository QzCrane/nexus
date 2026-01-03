import React from 'react';
import { useTranslation } from '../../i18n';
import { ALL_MODULES } from '../../kernel';
import { ModuleItem } from './module-item';
import { styles } from './panel.styles';

interface ModuleListProps {
	updates: any[];
	displayModules: typeof ALL_MODULES;
	installedModules: typeof ALL_MODULES;
	installingId: string | null;
	view: 'installed' | 'available' | 'all' | 'updates';
	filterType?: 'all' | 'app' | 'script' | 'system';
	handleInstall: (id: string) => void;
	handleUninstall: (m: typeof ALL_MODULES[0]) => void;
}

// Section header component for script sub-categories
const SectionHeader: React.FC<{ title: string; count: number; color: string }> = ({ title, count, color }) => (
	<div style={{
		display: 'flex', justifyContent: 'space-between', alignItems: 'center',
		padding: '8px 12px', margin: '8px 0 4px 0', borderRadius: '8px',
		background: `${color}15`, borderLeft: `3px solid ${color}`
	}}>
		<span style={{ fontWeight: 600, fontSize: '12px', color }}>{title}</span>
		<span style={{ fontSize: '11px', color: 'var(--halo-text-muted)' }}>{count}</span>
	</div>
);

export const ModuleList: React.FC<ModuleListProps> = ({
	updates, displayModules, installedModules, installingId, view, filterType = 'all', handleInstall, handleUninstall
}) => {
	const { t } = useTranslation();

	// When filterType is 'script', split into built-in and user scripts
	const isScriptFilter = filterType === 'script';
	const builtInScripts = isScriptFilter ? displayModules.filter(m => m.builtIn !== false) : [];
	const userScripts = isScriptFilter ? displayModules.filter(m => m.builtIn === false) : [];

	const renderModuleItem = (mod: typeof ALL_MODULES[0], index: number, isUserScript = false) => {
		const isInstalled = installedModules.some(m => m.id === mod.id);
		const loadingId = installingId;
		return (
			<ModuleItem
				key={mod.id}
				index={index + 1}
				module={mod}
				status={isInstalled ? (loadingId === mod.id ? 'updating' : 'installed') : (loadingId === mod.id ? 'downloading' : 'available')}
				isCore={!!(mod.builtIn && !mod.toolType)}
				showTypeLabel={filterType === 'all'}
				isUserScript={isUserScript}
				onInstall={() => handleInstall(mod.id)}
				onUninstall={() => handleUninstall(mod)}
			/>
		);
	};

	if (displayModules.length === 0) {
		return (
			<div style={styles.list}>
				<div style={styles.empty}>
					<span style={{ fontSize: '32px', marginBottom: '8px' }}>✅</span>
					{view === 'available' ? t('moduleStorePanel.allInstalled') : t('moduleStorePanel.noModules')}
				</div>
			</div>
		);
	}

	// Script filter: show grouped view
	if (isScriptFilter) {
		return (
			<div style={styles.list}>
				{builtInScripts.length > 0 && (
					<>
						<SectionHeader title={t('common.builtInScripts')} count={builtInScripts.length} color="#f59e0b" />
						{builtInScripts.map((mod, i) => renderModuleItem(mod, i, false))}
					</>
				)}
				{userScripts.length > 0 && (
					<>
						<SectionHeader title={t('common.userScripts')} count={userScripts.length} color="#6b7280" />
						{userScripts.map((mod, i) => renderModuleItem(mod, i, true))}
					</>
				)}
			</div>
		);
	}

	// Default: flat list
	return (
		<div style={styles.list}>
			{displayModules.map((mod, index) => renderModuleItem(mod, index))}
		</div>
	);
};
