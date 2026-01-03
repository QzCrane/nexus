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

export const ModuleList: React.FC<ModuleListProps> = ({
	updates, displayModules, installedModules, installingId, view, filterType = 'all', handleInstall, handleUninstall
}) => {
	const { t } = useTranslation();

	const renderModuleItem = (mod: typeof ALL_MODULES[0], index: number) => {
		const isInstalled = installedModules.some(m => m.id === mod.id);
		const loadingId = installingId;
		// Determine if this is a user script (read-only)
		const isUserScript = (mod as any).isUserScript === true;

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

	return (
		<div style={styles.list}>
			{displayModules.map((mod, index) => renderModuleItem(mod, index))}
		</div>
	);
};
