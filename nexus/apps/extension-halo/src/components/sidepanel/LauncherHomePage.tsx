// goal: Launcher home page with tool grid and categories
// eff: Extracted from LauncherLayout for file size compliance

import React from 'react';
import { useTranslation } from '../../i18n';
import type { ToolId, ToolMeta, HaloSettings } from '../../kernel';
import { popOutWindow } from '../../kernel';
import type { ToolCategory } from '../../i18n/types';
import { SearchBar } from '../SearchBar';
import { commonStyles } from './layouts.styles';

interface LauncherHomePageProps {
	visibleTools: ToolMeta[];
	settings: HaloSettings | null;
	onSettingsChange: (settings: HaloSettings) => void;
	onSelectTool: (id: ToolId) => void;
	onToggleMode: () => void;
	collapsedCategories: Record<string, boolean>;
	toggleCategory: (category: string) => void;
}

export const LauncherHomePage: React.FC<LauncherHomePageProps> = ({
	visibleTools,
	settings,
	onSettingsChange,
	onSelectTool,
	onToggleMode,
	collapsedCategories,
	toggleCategory
}) => {
	const { t } = useTranslation();
	const showLabels = settings?.showToolLabels ?? true;

	// Separate tools into categories, excluding system tools
	const categorizedTools = React.useMemo(() => {
		const cats: Record<ToolCategory, ToolMeta[]> = {
			general: [], dev: [], efficiency: [], visual: [],
			ai: [], security: [], media: [], browser: []
		};

		visibleTools.forEach((tool: ToolMeta) => {
			// Skip system tools
			if (tool.system) return;
			
			if (cats[tool.category]) {
				cats[tool.category].push(tool);
			} else {
				cats.general.push(tool);
			}
		});

		return cats;
	}, [visibleTools]);

	const toggleLabels = () => {
		if (settings) {
			onSettingsChange({ ...settings, showToolLabels: !showLabels });
		}
	};

	const moduleStore = visibleTools.find(t => t.id === 'module-store');
	const toolCount = visibleTools.filter(t => !t.system).length;

	return (
		<div style={{ width: '50%', height: '100%', display: 'flex', flexDirection: 'column' }}>
			<header style={commonStyles.header}>
				<div style={commonStyles.headerContent}>
					<span style={{ fontSize: '20px' }}>🌟</span>
					<h1 style={commonStyles.title}>HALO</h1>
				</div>
				<div style={commonStyles.headerActions}>
					<button 
						style={{ ...commonStyles.iconBtn, fontSize: '12px', width: 'auto', padding: '0 6px' }} 
						onClick={toggleLabels}
						title={showLabels ? t('layout.hideLabels') : t('layout.showLabels')}
					>
						{showLabels ? '📝' : '✖️'}
					</button>
					<button 
						style={commonStyles.iconBtn} 
						onClick={onToggleMode}
						title={t('layout.mode') + ': ' + t('layout.launcher')}
					>
						📱
					</button>
					<button 
						style={commonStyles.iconBtn} 
						onClick={popOutWindow}
						title={t('layout.popOut')}
					>
						📤
					</button>
					{moduleStore && (
						<button
							style={commonStyles.iconBtn}
							onClick={() => onSelectTool(moduleStore.id as ToolId)}
							title={t(`tools.${moduleStore.id}.name`)}
						>
							{moduleStore.icon}
						</button>
					)}
					<button 
						style={commonStyles.iconBtn} 
						onClick={() => onSelectTool('settings' as ToolId)}
						title={t('common.settings')}
					>
						⚙️
					</button>
				</div>
			</header>
			
			<div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
				<div style={{ margin: '12px 0', padding: '0 12px' }}>
					<SearchBar onSelect={(id) => onSelectTool(id as ToolId)} />
				</div>

				<div style={commonStyles.toolbar}>
					{(Object.keys(categorizedTools) as ToolCategory[]).map(category => {
						const tools = categorizedTools[category];
						if (tools.length === 0) return null;
						const isCollapsed = collapsedCategories[category];

						return (
							<div key={category} style={commonStyles.categorySection}>
								<div 
									style={{ 
										...commonStyles.categoryTitle as React.CSSProperties, 
										display: 'flex', justifyContent: 'space-between', alignItems: 'center',
										cursor: 'pointer', userSelect: 'none'
									}}
									onClick={() => toggleCategory(category)}
								>
									<div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
										<span style={{ 
											transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
											transition: 'transform 0.2s', fontSize: '10px', opacity: 0.6
										}}>▼</span>
										<span>{t(`categories.${category}`)}</span>
									</div>
									<span style={{ fontSize: '10px', opacity: 0.6, marginRight: '4px' }}>{tools.length}</span>
								</div>
								
								{!isCollapsed && (
									<div style={commonStyles.toolGrid}>
										{tools.map((tool) => {
											const isReady = tool.status === 'ready' || tool.status === 'beta';
											return (
												<button
													key={tool.id}
													onClick={() => isReady && onSelectTool(tool.id as ToolId)}
													disabled={!isReady}
													style={{
														...commonStyles.toolBtn,
														aspectRatio: '1/1', height: 'auto',
														opacity: isReady ? 1 : 0.4,
														cursor: isReady ? 'pointer' : 'not-allowed',
													}}
													title={isReady ? t(`tools.${tool.id}.name`) : `${t(`tools.${tool.id}.name`)} (${t('common.comingSoon')})`}
												>
													<span style={commonStyles.toolIcon}>{tool.icon}</span>
													{showLabels && <span style={commonStyles.toolLabel}>{t(`tools.${tool.id}.name`)}</span>}
												</button>
											);
										})}
									</div>
								)}
							</div>
						);
					})}
				</div>
			</div>

			<div style={commonStyles.footer}>
				<span>🔒 {t('footer.zeroTracking')}</span>
				<span>•</span>
				<span>💾 {t('footer.localOnly')}</span>
				<span>•</span>
				<span>🛠️ {toolCount} {t('common.tools')}</span>
			</div>
		</div>
	);
};
