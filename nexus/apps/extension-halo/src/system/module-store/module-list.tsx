import type React from 'react';
import { useTranslation } from '../../i18n';
import type { PluginMeta } from '../../kernel';
import { ModuleItem } from './module-item';
import { styles } from './panel.styles';

interface ModuleListProps {
	displayModules: PluginMeta[];
	enabledModules: PluginMeta[];
	changingId: string | null;
	view: 'enabled' | 'disabled' | 'all' | 'updates';
	filterType?: 'all' | 'app' | 'script' | 'system';
	handleEnable: (id: string) => void;
	handleDisable: (module: PluginMeta) => void;
}

export const ModuleList: React.FC<ModuleListProps> = ({
	displayModules, enabledModules, changingId, view, filterType = 'all', handleEnable, handleDisable
}) => {
	const { t } = useTranslation();

	const renderModuleItem = (mod: PluginMeta, index: number) => {
		const isEnabled = enabledModules.some(m => m.id === mod.id);
		const loadingId = changingId;
		// User scripts are managed by the dedicated User Scripts surface.
		const isUserScript = mod.isUserScript === true;

		return (
			<ModuleItem
				key={mod.id}
				index={index + 1}
				module={mod}
				status={isEnabled ? (loadingId === mod.id ? 'updating' : 'enabled') : (loadingId === mod.id ? 'enabling' : 'disabled')}
				isCore={mod.builtIn === true}
				showTypeLabel={filterType === 'all'}
				isUserScript={isUserScript}
				onEnable={() => handleEnable(mod.id)}
				onDisable={() => handleDisable(mod)}
			/>
		);
	};

	if (displayModules.length === 0) {
		return (
			<div style={styles.list}>
				<div style={styles.empty}>
					<span style={{ fontSize: '32px', marginBottom: '8px' }}>✅</span>
					{view === 'disabled' ? t('moduleStorePanel.allEnabled') : t('moduleStorePanel.noModules')}
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
