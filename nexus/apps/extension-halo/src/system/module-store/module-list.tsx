import type React from 'react';
import { useTranslation } from '../../i18n';
import type { PluginMeta } from '../../kernel';
import { ModuleItem } from './module-item';
import { styles } from './panel.styles';

interface ModuleListProps {
	displayModules: PluginMeta[];
	installedModules: PluginMeta[];
	installingId: string | null;
	view: 'installed' | 'available' | 'all' | 'updates';
	filterType?: 'all' | 'app' | 'script' | 'system';
	handleInstall: (id: string) => void;
	handleUninstall: (module: PluginMeta) => void;
}

export const ModuleList: React.FC<ModuleListProps> = ({
	displayModules, installedModules, installingId, view, filterType = 'all', handleInstall, handleUninstall
}) => {
	const { t } = useTranslation();

	const renderModuleItem = (mod: PluginMeta, index: number) => {
		const isInstalled = installedModules.some(m => m.id === mod.id);
		const loadingId = installingId;
		// User scripts are managed by the dedicated User Scripts surface.
		const isUserScript = mod.isUserScript === true;

		return (
			<ModuleItem
				key={mod.id}
				index={index + 1}
				module={mod}
				status={isInstalled ? (loadingId === mod.id ? 'updating' : 'installed') : (loadingId === mod.id ? 'downloading' : 'available')}
				isCore={mod.builtIn === true}
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
