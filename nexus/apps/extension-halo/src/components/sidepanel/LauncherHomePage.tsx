import type React from 'react';
import { useState, useRef, useMemo } from 'react';
import { useTranslation } from '../../i18n';
import type { ToolId, ToolMeta, HaloSettings } from '../../kernel';
import { useSmoothWheel } from '../../kernel/hooks/use-smooth-wheel';
import { SearchBar } from '../search/SearchBar';
import { LauncherToolItem } from './LauncherToolItem';
import { ToolAnimations } from './LauncherToolItemParts';
import { commonStyles } from './layouts.styles';
import { useActiveServices } from './ActiveServicesContext';
import { useUserScripts } from '../../kernel/hooks/use-user-scripts';
import { useCategorizedTools } from './hooks/use-categorized-tools';

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
	onEditScript?: (scriptId: string) => void;
}

const SPECIAL_CATEGORY_COLORS = {
	active: { border: '#10b981', bg: 'rgba(76, 175, 80, 0.08)', text: '#10b981', dot: '#4CAF50' },
	scripts: { border: '#f59e0b', bg: 'rgba(245, 158, 11, 0.08)', text: '#f59e0b' },
	system: { border: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.08)', text: '#8b5cf6' },
} as const;

export const LauncherHomePage: React.FC<LauncherHomePageProps> = ({
	visibleTools, settings, onSelectTool, collapsedCategories, toggleCategory,
	onTogglePin, onReorderTools, onReorderCategories, openTools, onEditScript
}) => {
	const { t } = useTranslation();
	const { activeServices, bgToolIds: BACKGROUND_TOOL_IDS } = useActiveServices();
	const { scripts } = useUserScripts();
	const scrollRef = useRef<HTMLDivElement>(null);
	const [draggingId, setDraggingId] = useState<string | null>(null);
	const [draggingCat, setDraggingCat] = useState<string | null>(null);
	const [tempCats, setTempCats] = useState<Record<string, ToolMeta[]> | null>(null);
	const [tempCatOrder, setTempCatOrder] = useState<string[] | null>(null);

	useSmoothWheel(scrollRef, 'y');

	const SAFE_DEFAULTS = { spacing: 12, iconSize: 24 };
	const rawSpacing = settings?.spacing;
	const legacyCompactMode = settings !== null
		&& 'compactMode' in settings
		&& settings.compactMode === true;
	const spacing = typeof rawSpacing === 'number'
		? rawSpacing
		: legacyCompactMode ? 4 : SAFE_DEFAULTS.spacing;

	const rawIconSize: unknown = settings?.iconSize;
	let iconSize = typeof rawIconSize === 'number' ? rawIconSize : SAFE_DEFAULTS.iconSize;
	if (typeof rawIconSize === 'string') {
		if (rawIconSize === 'small') iconSize = 18;
		else if (rawIconSize === 'large') iconSize = 32;
		else iconSize = 24;
	}

	// These projections are consumed repeatedly across every visible card. Keep
	// membership O(1) and avoid rebuilding the search/footer tool subset twice.
	const userTools = useMemo(
		() => visibleTools.filter((tool) => tool.pluginType !== 'system'),
		[visibleTools],
	);
	const backgroundToolIds = useMemo(
		() => new Set(BACKGROUND_TOOL_IDS),
		[BACKGROUND_TOOL_IDS],
	);
	const openToolIds = useMemo(() => new Set<ToolId>(openTools), [openTools]);

	const { categorizedTools, catOrder } = useCategorizedTools({
		visibleTools, settings, t,
		activeServices, backgroundToolIds: BACKGROUND_TOOL_IDS,
		scripts, tempCats, tempCatOrder
	});

	const onDragStart = (e: React.DragEvent, id: string) => { setDraggingId(id); e.dataTransfer.setData('toolId', id); };
	const onCatDragStart = (e: React.DragEvent, cat: string) => { setDraggingCat(cat); e.dataTransfer.setData('catId', cat); };

	const onDragEnter = (cat: string, targetId: string) => {
		if (!draggingId || draggingId === targetId) return;
		const current = categorizedTools[cat] || [];
		const oldIdx = current.findIndex(t => t.id === draggingId), newIdx = current.findIndex(t => t.id === targetId);
		if (oldIdx !== -1 && newIdx !== -1) {
			const newList = [...current];
			const [item] = newList.splice(oldIdx, 1);
			if (!item) return;
			newList.splice(newIdx, 0, item);
			setTempCats({ ...categorizedTools, [cat]: newList });
		}
	};

	const onCatDragEnter = (targetCat: string) => {
		if (!draggingCat || draggingCat === targetCat) return;
		const oldIdx = catOrder.indexOf(draggingCat), newIdx = catOrder.indexOf(targetCat);
		if (oldIdx !== -1 && newIdx !== -1) {
			const newOrder = [...catOrder];
			const [item] = newOrder.splice(oldIdx, 1);
			if (item === undefined) return;
			newOrder.splice(newIdx, 0, item);
			setTempCatOrder(newOrder);
		}
	};

	const onDrop = (e: React.DragEvent, cat: string) => {
		e.preventDefault();
		const tools = tempCats?.[cat];
		if (tools) onReorderTools(cat, tools.map(t => t.id));
		setDraggingId(null); setTempCats(null);
	};

	const onCatDrop = (e: React.DragEvent) => {
		e.preventDefault();
		if (tempCatOrder) onReorderCategories(tempCatOrder);
		setDraggingCat(null); setTempCatOrder(null);
	};

	const minColWidth = Math.max(64, iconSize + 48);

	return (
		<div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
			{/* One animation definition for the whole grid; never one <style> per card. */}
			<ToolAnimations />
			<div style={{ margin: `${spacing}px 0`, padding: '0 12px', flexShrink: 0 }}>
				<SearchBar onSelect={(id) => onSelectTool(id as ToolId)} visibleTools={userTools} />
			</div>
			<div ref={scrollRef} className="halo-scrollbar" style={{ ...commonStyles.toolbar, flex: 1, overflowY: 'auto', gap: `${spacing}px`, padding: `0 ${Math.max(8, spacing)}px ${Math.max(8, spacing)}px`, minHeight: 0 }}>
				{catOrder.map(cat => {
					const tools = categorizedTools[cat];
					if (!tools || tools.length === 0) return null;

					const isActiveCat = cat === 'active';
					const isScriptsCat = cat === 'scripts';
					const isSystemCat = cat === 'system';
					const isSpecialCat = isActiveCat || isScriptsCat || isSystemCat;
					const colors = SPECIAL_CATEGORY_COLORS[cat as keyof typeof SPECIAL_CATEGORY_COLORS];
					const dotColor = colors && 'dot' in colors ? colors.dot : undefined;

					return (
						<div key={cat} style={{ ...commonStyles.categorySection, gap: `${Math.max(4, spacing / 2)}px` }}>
						<button
							type="button"
							draggable onDragStart={(e) => onCatDragStart(e, cat)} onDragEnter={() => onCatDragEnter(cat)} onDragOver={(e) => e.preventDefault()} onDrop={onCatDrop}
							style={{
								...commonStyles.categoryTitle,
								display: 'flex', justifyContent: 'space-between', alignItems: 'center',
								cursor: 'pointer', padding: '4px',
								borderLeft: isSpecialCat && colors ? `3px solid ${colors.border}` : 'none',
								background: isSpecialCat && colors ? colors.bg : 'transparent',
								width: '100%', borderTop: 'none', borderRight: 'none', borderBottom: 'none',
								color: 'inherit', textAlign: 'left',
							}}
							onClick={() => toggleCategory(cat)}
						>
							<span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
								<span style={{ transform: collapsedCategories[cat] ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'var(--halo-motion-transition, transform 0.2s)', fontSize: '10px', opacity: 0.6 }}>▼</span>
								<span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
									{isSpecialCat && dotColor && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: dotColor, boxShadow: `0 0 6px ${dotColor}` }}></span>}
									<span style={{ color: isSpecialCat && colors ? colors.text : 'inherit', fontWeight: isSpecialCat ? 700 : 600 }}>{t(`categories.${cat}`)}</span>
								</span>
							</span>
							<span style={{ fontSize: '10px', opacity: 0.6 }}>{tools.length}</span>
						</button>
							{!collapsedCategories[cat] && (
								<div style={{ ...commonStyles.toolGrid, gap: `${spacing}px`, gridTemplateColumns: `repeat(auto-fill, minmax(${minColWidth}px, 1fr))` }}>
									{tools.map(tool => {
										const isActiveService = activeServices.has(tool.id);
										const isBackgroundCapable = backgroundToolIds.has(tool.id);
										const serviceState = isActiveService ? 'active' : (isBackgroundCapable ? 'inactive' : undefined);

										return (
											<LauncherToolItem
												key={tool.id} tool={tool} settings={settings} iconSize={iconSize} spacing={spacing}
												showLabels={settings?.showToolLabels ?? true} draggingId={draggingId} onSelect={onSelectTool}
												onTogglePin={onTogglePin} onDragStart={onDragStart}
												onDragOver={(e) => { e.preventDefault(); onDragEnter(cat, tool.id); }}
												onDrop={(e) => onDrop(e, cat)}
												isRunning={tool.pluginType !== 'system' && openToolIds.has(tool.id as ToolId)}
												serviceState={serviceState} onEditScript={onEditScript}
											/>
										);
									})}
								</div>
							)}
						</div>
					);
				})}
				<div style={{ ...commonStyles.footer, marginTop: '20px' }}><span>🔒 {t('footer.zeroTracking')}</span><span>•</span><span>💾 {t('footer.localOnly')}</span><span>•</span><span>🛠️ {userTools.length} {t('common.tools')}</span></div>
			</div>
		</div>
	);
};
