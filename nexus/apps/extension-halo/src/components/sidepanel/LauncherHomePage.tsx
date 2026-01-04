import React, { useRef, useMemo } from 'react';
import { useTranslation } from '../../i18n';
import type { ToolId, ToolMeta, HaloSettings } from '../../kernel';
import { useSmoothWheel } from '../../kernel/hooks/use-smooth-wheel';
import { SearchBar } from '../SearchBar';
import { LauncherToolItem } from './LauncherToolItem';
import { commonStyles } from './layouts.styles';
import { useActiveServices } from './ActiveServicesContext';
import { useUserScripts } from '../../kernel/hooks/use-user-scripts';
import { useCategorizedTools } from './hooks/use-categorized-tools';
import { useLauncherDnD } from './hooks/use-launcher-dnd';
import { CategoryHeader } from './CategoryHeader';

interface LauncherHomePageProps {
	visibleTools: ToolMeta[];
	settings: HaloSettings | null;
	onSelectTool: (id: ToolId) => void;
	collapsedCategories: Record<string, boolean>;
	toggleCategory: (category: string) => void;
	onTogglePin: (id: string) => void;
	onReorderTools: (category: string, ids: string[]) => void;
	onReorderCategories: (ids: string[]) => void;
	openTools: ToolId[];
	onToggleScript?: (tool: ToolMeta) => void;
	onEditScript?: (scriptId: string) => void;
}

export const LauncherHomePage: React.FC<LauncherHomePageProps> = ({
	visibleTools, settings, onSelectTool, collapsedCategories, toggleCategory,
	onTogglePin, onReorderTools, onReorderCategories, openTools, onToggleScript, onEditScript
}) => {
	const { t } = useTranslation();
	const { activeServices, bgToolIds: BACKGROUND_TOOL_IDS } = useActiveServices();
	const { scripts } = useUserScripts();
	const scrollRef = useRef<HTMLDivElement>(null);
	
	useSmoothWheel(scrollRef, 'y');
	
	const SAFE_DEFAULTS = { spacing: 12, iconSize: 24 };
	const rawSpacing = settings?.spacing;
	const spacing = typeof rawSpacing === 'number' ? rawSpacing : (settings as any)?.compactMode ? 4 : SAFE_DEFAULTS.spacing;
	
	const rawIconSize = settings?.iconSize;
	let iconSize = typeof rawIconSize === 'number' ? rawIconSize : SAFE_DEFAULTS.iconSize;
	if (typeof rawIconSize === 'string') {
		if (rawIconSize === 'small') iconSize = 18;
		else if (rawIconSize === 'large') iconSize = 32;
		else iconSize = 24;
	}

	const userTools = useMemo(() => visibleTools, [visibleTools]);

	const { categorizedTools, catOrder } = useCategorizedTools({
		visibleTools, settings, t,
		activeServices, backgroundToolIds: BACKGROUND_TOOL_IDS,
		scripts, tempCats: null, tempCatOrder: null
	});

	const {
		draggingId, onDragStart, onCatDragStart, onDragEnter, onCatDragEnter, onDrop, onCatDrop
	} = useLauncherDnD({
		categorizedTools, catOrder, onReorderTools, onReorderCategories
	});
	
	const minColWidth = Math.max(64, iconSize + 48);

	return (
		<div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
			<div style={{ margin: `${spacing}px 0`, padding: '0 12px', flexShrink: 0 }}>
				<SearchBar onSelect={(id) => onSelectTool(id as ToolId)} visibleTools={userTools.filter(t => !t.system)} />
			</div>
			<div ref={scrollRef} className="halo-scrollbar" style={{ ...commonStyles.toolbar as any, flex: 1, overflowY: 'auto', gap: `${spacing}px`, padding: `0 ${Math.max(8, spacing)}px ${Math.max(8, spacing)}px`, minHeight: 0 }}>
				{catOrder.map(cat => {
					const tools = categorizedTools[cat];
					if (!tools || tools.length === 0) return null;
					
					return (
						<div key={cat} style={{ ...commonStyles.categorySection as any, gap: `${Math.max(4, spacing / 2)}px` }}>
							<CategoryHeader
								cat={cat}
								title={t(`categories.${cat}`)}
								count={tools.length}
								isCollapsed={collapsedCategories[cat]}
								onToggle={() => toggleCategory(cat)}
								onDragStart={(e) => onCatDragStart(e, cat)}
								onDragEnter={() => onCatDragEnter(cat)}
								onDrop={onCatDrop}
							/>
							{!collapsedCategories[cat] && (
								<div onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, cat)} style={{ ...commonStyles.toolGrid as any, gap: `${spacing}px`, gridTemplateColumns: `repeat(auto-fill, minmax(${minColWidth}px, 1fr))` }}>
									{tools.map(tool => {
										const isActiveService = activeServices.has(tool.id);
										const isBackgroundCapable = BACKGROUND_TOOL_IDS.includes(tool.id);
										const serviceState = isActiveService ? 'active' : (isBackgroundCapable ? 'inactive' : undefined);
										
										return (
											<LauncherToolItem 
												key={tool.id} 
												tool={tool} 
												settings={settings} 
												iconSize={iconSize}
												spacing={spacing}
												showLabels={settings?.showToolLabels ?? true} 
												draggingId={draggingId} 
												onSelect={onSelectTool} 
												onTogglePin={onTogglePin} 
												onDragStart={onDragStart} 
												onDragOver={(e) => { e.preventDefault(); onDragEnter(cat, tool.id); }} 
												onDrop={(e) => e.preventDefault()} 
												isRunning={openTools.includes(tool.id as ToolId)} 
												serviceState={serviceState}
												onToggleScript={onToggleScript}
												onEditScript={onEditScript}
											/>
										);
									})}
								</div>
							)}
						</div>
					);
				})}
				<div style={{ ...commonStyles.footer as any, marginTop: '20px' }}><span>🔒 {t('footer.zeroTracking')}</span><span>•</span><span>💾 {t('footer.localOnly')}</span><span>•</span><span>🛠️ {visibleTools.filter(t => !t.system).length} {t('common.tools')}</span></div>
			</div>
		</div>
	);
};
