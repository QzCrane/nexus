import React, { useState, useRef } from 'react';
import { useTranslation } from '../../i18n';
import type { ToolId, ToolMeta, HaloSettings } from '../../kernel';
import type { ToolCategory } from '../../i18n/types';
import { useSmoothWheel } from '../../kernel/hooks/use-smooth-wheel';
import { SearchBar } from '../SearchBar';
import { LauncherToolItem } from './LauncherToolItem';
import { commonStyles } from './layouts.styles';

interface LauncherHomePageProps {
	visibleTools: ToolMeta[];
	settings: HaloSettings | null;
	onSelectTool: (id: ToolId) => void;
	collapsedCategories: Record<string, boolean>;
	toggleCategory: (category: string) => void;
	onTogglePin: (id: string) => void;
	onReorderTools: (category: string, ids: string[]) => void;
	openTools: ToolId[];
}

export const LauncherHomePage: React.FC<LauncherHomePageProps> = ({
	visibleTools,
	settings,
	onSelectTool,
	collapsedCategories,
	toggleCategory,
	onTogglePin,
	onReorderTools,
	openTools
}) => {
	const { t } = useTranslation();
	const scrollRef = useRef<HTMLDivElement>(null);
	const [draggingId, setDraggingId] = useState<string | null>(null);

	// Custom smooth scrolling
	useSmoothWheel(scrollRef, 'y');
	
	const showLabels = settings?.showToolLabels ?? true;
	const isCompact = settings?.compactMode ?? false;

	const [tempCategorizedTools, setTempCategorizedTools] = useState<Record<ToolCategory, ToolMeta[]> | null>(null);

	const categorizedTools = React.useMemo(() => {
		if (tempCategorizedTools) return tempCategorizedTools;
		
		const cats: Record<ToolCategory, ToolMeta[]> = {
			general: [], dev: [], efficiency: [], visual: [],
			ai: [], security: [], media: [], browser: []
		};
		visibleTools.forEach((tool: ToolMeta) => {
			if (tool.system || tool.id === 'permissions') return;
			if (cats[tool.category]) cats[tool.category].push(tool);
			else cats.general.push(tool);
		});
		(Object.keys(cats) as ToolCategory[]).forEach(cat => {
			const pinned = settings?.pinnedTools || [];
			const customOrder = settings?.toolOrder?.[cat] || [];
			cats[cat].sort((a, b) => {
				const aPinned = pinned.includes(a.id), bPinned = pinned.includes(b.id);
				if (aPinned && !bPinned) return -1;
				if (!aPinned && bPinned) return 1;
				const aIdx = customOrder.indexOf(a.id), bIdx = customOrder.indexOf(b.id);
				if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
				if (aIdx !== -1) return -1;
				if (bIdx !== -1) return 1;
				return t(`tools.${a.id}.name`).localeCompare(t(`tools.${b.id}.name`));
			});
		});
		return cats;
	}, [visibleTools, settings, t, tempCategorizedTools]);

	const onDragStart = (e: React.DragEvent, id: string) => {
		setDraggingId(id);
		e.dataTransfer.setData('toolId', id);
		e.dataTransfer.effectAllowed = 'move';
	};

	const onDragEnter = (cat: string, targetId: string) => {
		if (!draggingId || draggingId === targetId) return;
		
		const catKey = cat as ToolCategory;
		const currentTools = categorizedTools[catKey];
		const oldIdx = currentTools.findIndex(t => t.id === draggingId);
		const newIdx = currentTools.findIndex(t => t.id === targetId);

		if (oldIdx !== -1 && newIdx !== -1) {
			const newList = [...currentTools];
			const [draggedItem] = newList.splice(oldIdx, 1);
			newList.splice(newIdx, 0, draggedItem);
			
			setTempCategorizedTools({
				...categorizedTools,
				[catKey]: newList
			});
		}
	};

	const onDrop = (e: React.DragEvent, cat: string) => {
		e.preventDefault();
		if (tempCategorizedTools) {
			const newIds = tempCategorizedTools[cat as ToolCategory].map(t => t.id);
			onReorderTools(cat, newIds);
		}
		setDraggingId(null);
		setTempCategorizedTools(null);
	};

	return (
		<div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
			{/* FIXED HEADER: Search bar acts as part of title area */}
			<div style={{ margin: isCompact ? '8px 0' : '12px 0', padding: '0 12px', flexShrink: 0 }}>
				<SearchBar onSelect={(id) => onSelectTool(id as ToolId)} visibleTools={visibleTools} />
			</div>

			{/* SCROLLABLE CONTENT: Categories and Tools */}
			<div 
				ref={scrollRef}
				className="halo-scrollbar" 
				style={{ 
				...commonStyles.toolbar as any, 
				flex: 1,
				overflowY: 'auto',
				gap: isCompact ? '4px' : '12px', 
				padding: isCompact ? '0 8px 8px 8px' : '0 12px 12px 12px',
				minHeight: 0
			}}>
				{(Object.keys(categorizedTools) as ToolCategory[]).map(category => {
						const tools = categorizedTools[category];
						if (tools.length === 0) return null;
						const isCollapsed = collapsedCategories[category];
						return (
							<div key={category} style={{ ...commonStyles.categorySection as any, gap: isCompact ? '4px' : '8px' }}>
								<div style={{ ...commonStyles.categoryTitle as any, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none', padding: isCompact ? '2px 4px' : '4px' }} onClick={() => toggleCategory(category)}>
									<div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
										<span style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', fontSize: '10px', opacity: 0.6 }}>▼</span>
										<span>{t(`categories.${category}`)}</span>
									</div>
									<span style={{ fontSize: '10px', opacity: 0.6, marginRight: '4px' }}>{tools.length}</span>
								</div>
								{!isCollapsed && (
									<div 
										onDragOver={(e) => e.preventDefault()}
										onDrop={(e) => onDrop(e, category)}
										style={{ 
											...commonStyles.toolGrid as any, 
											gap: isCompact ? '4px' : '8px', 
											gridTemplateColumns: isCompact ? 'repeat(auto-fill, minmax(64px, 1fr))' : 'repeat(auto-fill, minmax(72px, 1fr))' 
										}}
									>
										{tools.map((tool) => (
											<LauncherToolItem
												key={tool.id}
												tool={tool}
												settings={settings}
												isCompact={isCompact}
												showLabels={showLabels}
												draggingId={draggingId}
												onSelect={onSelectTool}
												onTogglePin={onTogglePin}
												onDragStart={onDragStart}
												onDragOver={(e) => {
													e.preventDefault();
													onDragEnter(category, tool.id);
												}}
												onDrop={(e) => e.preventDefault()}
												isRunning={openTools.includes(tool.id as ToolId)}
											/>
										))}
									</div>
								)}
							</div>
						);
					})}
					{!isCompact && (
						<div style={{ ...commonStyles.footer as any, marginTop: '20px' }}>
							<span>🔒 {t('footer.zeroTracking')}</span><span>•</span><span>💾 {t('footer.localOnly')}</span><span>•</span><span>🛠️ {visibleTools.filter(t => !t.system && t.id !== 'permissions').length} {t('common.tools')}</span>
						</div>
					)}
				</div>
		</div>
	);
};
