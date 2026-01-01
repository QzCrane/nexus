// goal: Launcher tool page with taskbar (via Portal) and panel renderer
// eff: Pure content-area renderer for the second page slide

import React from 'react';
import { useTranslation } from '../../i18n';
import type { ToolId, HaloSettings } from '../../kernel';
import { ToolPanelRenderer } from '../tool-panel-renderer';

interface LauncherToolPageProps {
	activeTool: ToolId | null;
	openTools: ToolId[];
	onSettingsChange: (settings: HaloSettings) => void;
}

export const LauncherToolPage: React.FC<LauncherToolPageProps> = ({
	activeTool,
	openTools,
	onSettingsChange
}) => {
	const { t } = useTranslation();

	return (
		<div style={{ 
			width: '100%', 
			height: '100%', 
			display: 'flex', 
			flexDirection: 'column',
			boxSizing: 'border-box'
		}}>
			<div style={{ 
				flex: 1,
				display: 'flex',
				flexDirection: 'column',
				minHeight: 0,
				overflow: 'hidden'
			}}>
				<ToolPanelRenderer
					activeTool={activeTool}
					openTools={openTools || []}
					onSettingsChange={onSettingsChange}
					selectToolText={t('common.selectTool')}
				/>
			</div>
		</div>
	);
};
