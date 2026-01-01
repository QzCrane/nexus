// goal: Launcher tool page with taskbar and panel renderer
// eff: Extracted from LauncherLayout for file size compliance

import React from 'react';
import { useTranslation } from '../../i18n';
import type { ToolId, ToolMeta, HaloSettings } from '../../kernel';
import { popOutWindow } from '../../kernel';
import { ToolPanelRenderer } from '../tool-panel-renderer';
import { commonStyles } from './layouts.styles';

interface LauncherToolPageProps {
	activeTool: ToolId | null;
	openTools: ToolId[];
	visibleTools: ToolMeta[];
	onBack: () => void;
	onSelectTool: (id: ToolId) => void;
	onCloseTool: (id: ToolId) => void;
	onSettingsChange: (settings: HaloSettings) => void;
}

export const LauncherToolPage: React.FC<LauncherToolPageProps> = ({
	activeTool,
	openTools,
	visibleTools,
	onBack,
	onSelectTool,
	onCloseTool,
	onSettingsChange
}) => {
	const { t } = useTranslation();

	// Filter out system tools from taskbar
	const taskbarTools = openTools.filter(id => {
		const tool = visibleTools.find(t => t.id === id);
		return !tool?.system;
	});

	return (
		<div style={{ width: '50%', height: '100%', display: 'flex', flexDirection: 'column' }}>
			<header style={commonStyles.header}>
				<div style={commonStyles.headerContent}>
					<button 
						style={{ ...commonStyles.iconBtn, width: 'auto', padding: '0 8px', gap: '4px' }}
						onClick={onBack}
						title={t('common.back')}
					>
						<span style={{ fontSize: '18px' }}>←</span>
					</button>
					
					{/* Taskbar / Tabs */}
					<div className="halo-scrollbar" style={{ 
						display: 'flex', alignItems: 'center', gap: '4px',
						overflowX: 'auto', maxWidth: '100%', paddingBottom: '2px',
					}}>
						{taskbarTools.map(toolId => {
							const tool = visibleTools.find(t => t.id === toolId);
							if (!tool) return null;
							const isActive = activeTool === toolId;
							return (
								<div 
									key={toolId}
									onClick={() => onSelectTool(toolId)}
									title={t(`tools.${tool.id}.name`)}
									style={{
										display: 'flex', alignItems: 'center', gap: '6px',
										padding: '4px 8px', borderRadius: '6px',
										background: isActive ? 'var(--halo-bg-tertiary)' : 'transparent',
										cursor: 'pointer',
										border: isActive ? '1px solid var(--halo-border)' : '1px solid transparent',
										opacity: isActive ? 1 : 0.6,
										maxWidth: isActive ? '160px' : '40px',
										height: '32px', flexShrink: isActive ? 0 : 1,
										whiteSpace: 'nowrap', overflow: 'hidden',
										transition: 'all 0.2s',
									}}
								>
									<span style={{ fontSize: '16px' }}>{tool.icon}</span>
									{isActive && (
										<span style={{ fontSize: '13px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>
											{t(`tools.${tool.id}.name`)}
										</span>
									)}
									{isActive && (
										<span 
											style={{ fontSize: '10px', marginLeft: '4px', opacity: 0.5, cursor: 'pointer', padding: '2px' }}
											onClick={(e) => { e.stopPropagation(); onCloseTool(toolId); }}
											onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
											onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.5')}
										>
											✖️
										</span>
									)}
								</div>
							);
						})}
					</div>
				</div>
				<div style={commonStyles.headerActions}>
					<button 
						style={commonStyles.iconBtn} 
						onClick={popOutWindow}
						title={t('layout.popOut')}
					>
						📤
					</button>
					<button 
						style={commonStyles.iconBtn} 
						onClick={() => onSelectTool('settings' as ToolId)}
					>
						⚙️
					</button>
				</div>
			</header>
			<div className="halo-scrollbar" style={{ ...commonStyles.content, overflowY: 'auto', padding: '16px' }}>
				<ToolPanelRenderer
					activeTool={activeTool}
					openTools={openTools}
					onSettingsChange={onSettingsChange}
					selectToolText={t('common.selectTool')}
				/>
			</div>
		</div>
	);
};
