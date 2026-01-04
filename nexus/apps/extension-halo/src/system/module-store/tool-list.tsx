import React from 'react';
import { useTranslation } from '../../i18n';
import { ALL_TOOLS } from '../../kernel';
import { ToolItem } from './tool-item';
import { styles } from './panel.styles';

interface ToolListProps {
	updates: any[];
	displayTools: typeof ALL_TOOLS;
	installedTools: typeof ALL_TOOLS;
	installingId: string | null;
	view: 'installed' | 'available' | 'all' | 'updates';
	filterType?: 'all' | 'app' | 'script' | 'system';
	handleInstall: (id: string) => void;
	handleUninstall: (m: typeof ALL_TOOLS[0]) => void;
}

export const ToolList: React.FC<ToolListProps> = ({
	updates, displayTools, installedTools, installingId, view, filterType = 'all', handleInstall, handleUninstall
}) => {
	const { t } = useTranslation();

	const renderToolItem = (mod: typeof ALL_TOOLS[0], index: number) => {
		const isInstalled = installedTools.some(m => m.id === mod.id);
		const loadingId = installingId;
		// Determine if this is a user script (read-only)
		const isUserScript = (mod as any).isUserScript === true;

		return (
			<ToolItem
				key={mod.id}
				index={index + 1}
				tool={mod}
				status={isInstalled ? (loadingId === mod.id ? 'updating' : 'installed') : (loadingId === mod.id ? 'downloading' : 'available')}
				isCore={!!(mod.builtIn && !mod.toolType)}
				showTypeLabel={filterType === 'all'}
				isUserScript={isUserScript}
				onInstall={() => handleInstall(mod.id)}
				onUninstall={() => handleUninstall(mod)}
			/>
		);
	};

	if (displayTools.length === 0) {
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
			{displayTools.map((mod, index) => renderToolItem(mod, index))}
		</div>
	);
};
