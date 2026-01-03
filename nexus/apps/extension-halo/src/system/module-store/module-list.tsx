
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
	filterType?: 'all' | 'app' | 'script' | 'system'; // Add this
	handleInstall: (id: string) => void;
	handleUninstall: (m: typeof ALL_MODULES[0]) => void;
}

export const ModuleList: React.FC<ModuleListProps> = ({
	updates, displayModules, installedModules, installingId, view, filterType = 'all', handleInstall, handleUninstall
}) => {
	const { t } = useTranslation();

	// ... (updates block remains same)

	return (
		<div style={styles.list}>
			{displayModules.length > 0 ? (
				displayModules.map((mod, index) => {
					const isInstalled = installedModules.some(m => m.id === mod.id);
					const loadingId = installingId;
					return (
						<ModuleItem
							key={mod.id}
							index={index + 1}
							module={mod}
							status={isInstalled ? (loadingId === mod.id ? 'updating' : 'installed') : (loadingId === mod.id ? 'downloading' : 'available')}
							isCore={!!(mod.builtIn && !mod.toolType)}
							showTypeLabel={filterType === 'all'} // Pass this
							onInstall={() => handleInstall(mod.id)}
							onUninstall={() => handleUninstall(mod)}
						/>
					);
				})
			) : (
// ...
				<div style={styles.empty}>
					<span style={{ fontSize: '32px', marginBottom: '8px' }}>✅</span>
					{view === 'available' ? t('moduleStorePanel.allInstalled') : t('moduleStorePanel.noModules')}
				</div>
			)}
		</div>
	);
};
