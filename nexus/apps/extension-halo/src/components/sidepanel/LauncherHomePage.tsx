import React, { useState, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import type { ToolId, ToolMeta, HaloSettings } from '../../kernel';
import type { ToolCategory } from '../../i18n/types';
import { useSmoothWheel } from '../../kernel/hooks/use-smooth-wheel';
import { SearchBar } from '../SearchBar';
import { LauncherToolItem } from './LauncherToolItem';
import { commonStyles } from './layouts.styles';

const PRO_TOOL_IDS = ['qrcode', 'color-picker', 'hash', 'json-formatter', 'password-gen', 'uuid', 'timestamp', 'base64'];

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
}

export const LauncherHomePage: React.FC<LauncherHomePageProps> = ({
	visibleTools, settings, onSelectTool, collapsedCategories, toggleCategory,
	onTogglePin, onReorderTools, onReorderCategories, openTools
}) => {
	const { t } = useTranslation();
	const scrollRef = useRef<HTMLDivElement>(null);
	const [draggingId, setDraggingId] = useState<string | null>(null);
	const [draggingCat, setDraggingCat] = useState<string | null>(null);
	const [tempCats, setTempCats] = useState<Record<string, ToolMeta[]> | null>(null);
	const [tempCatOrder, setTempCatOrder] = useState<string[] | null>(null);

	useSmoothWheel(scrollRef, 'y');
	const isCompact = settings?.compactMode ?? false;

	const categorizedTools = useMemo(() => {
		if (tempCats) return tempCats;
		const cats: Record<string, ToolMeta[]> = { pro: [], general: [], dev: [], efficiency: [], visual: [], ai: [], security: [], media: [], browser: [] };
		visibleTools.forEach(tool => {
			if (tool.system || tool.id === 'permissions') return;
			if (PRO_TOOL_IDS.includes(tool.id)) cats.pro.push(tool);
			if (cats[tool.category]) cats[tool.category].push(tool);
			else cats.general.push(tool);
		});
		Object.keys(cats).forEach(cat => {
			const pinned = settings?.pinnedTools || [], order = settings?.toolOrder?.[cat] || [];
			cats[cat].sort((a, b) => {
				const ap = pinned.includes(a.id), bp = pinned.includes(b.id);
				if (ap !== bp) return ap ? -1 : 1;
				const ai = order.indexOf(a.id), bi = order.indexOf(b.id);
				if (ai !== -1 && bi !== -1) return ai - bi;
				return ai !== -1 ? -1 : bi !== -1 ? 1 : t(`tools.${a.id}.name`).localeCompare(t(`tools.${b.id}.name`));
			});
		});
		return cats;
	}, [visibleTools, settings, t, tempCats]);

	const catOrder = useMemo(() => {
		if (tempCatOrder) return tempCatOrder;
		const defaultOrder = ['pro', 'general', 'dev', 'efficiency', 'visual', 'ai', 'security', 'media', 'browser'];
		const saved = settings?.categoryOrder || [];
		return saved.length > 0 ? saved : defaultOrder;
	}, [settings, tempCatOrder]);

	const onDragStart = (e: React.DragEvent, id: string) => { setDraggingId(id); e.dataTransfer.setData('toolId', id); };
	const onCatDragStart = (e: React.DragEvent, cat: string) => { setDraggingCat(cat); e.dataTransfer.setData('catId', cat); };

	const onDragEnter = (cat: string, targetId: string) => {
		if (!draggingId || draggingId === targetId) return;
		const current = categorizedTools[cat];
		const oldIdx = current.findIndex(t => t.id === draggingId), newIdx = current.findIndex(t => t.id === targetId);
		if (oldIdx !== -1 && newIdx !== -1) {
			const newList = [...current]; const [item] = newList.splice(oldIdx, 1); newList.splice(newIdx, 0, item);
			setTempCats({ ...categorizedTools, [cat]: newList });
		}
	};

	const onCatDragEnter = (targetCat: string) => {
		if (!draggingCat || draggingCat === targetCat) return;
		const oldIdx = catOrder.indexOf(draggingCat), newIdx = catOrder.indexOf(targetCat);
		if (oldIdx !== -1 && newIdx !== -1) {
			const newOrder = [...catOrder]; const [item] = newOrder.splice(oldIdx, 1); newOrder.splice(newIdx, 0, item);
			setTempCatOrder(newOrder);
		}
	};

	const onDrop = (e: React.DragEvent, cat: string) => {
		e.preventDefault();
		if (tempCats) onReorderTools(cat, tempCats[cat].map(t => t.id));
		setDraggingId(null); setTempCats(null);
	};

	const onCatDrop = (e: React.DragEvent) => {
		e.preventDefault();
		if (tempCatOrder) onReorderCategories(tempCatOrder);
		setDraggingCat(null); setTempCatOrder(null);
	};

	return (
		<div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
			<div style={{ margin: isCompact ? '8px 0' : '12px 0', padding: '0 12px', flexShrink: 0 }}>
				<SearchBar onSelect={(id) => onSelectTool(id as ToolId)} visibleTools={visibleTools} />
			</div>
			<div ref={scrollRef} className="halo-scrollbar" style={{ ...commonStyles.toolbar as any, flex: 1, overflowY: 'auto', gap: isCompact ? '4px' : '12px', padding: isCompact ? '0 8px 8px 8px' : '0 12px 12px 12px', minHeight: 0 }}>
				{catOrder.map(cat => {
					const tools = categorizedTools[cat];
					if (!tools || tools.length === 0) return null;
					const isPro = cat === 'pro';
					return (
						<div key={cat} style={{ ...commonStyles.categorySection as any, gap: isCompact ? '4px' : '8px' }}>
							<div 
								draggable onDragStart={(e) => onCatDragStart(e, cat)} onDragEnter={() => onCatDragEnter(cat)} onDragOver={(e) => e.preventDefault()} onDrop={onCatDrop}
								style={{ ...commonStyles.categoryTitle as any, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', padding: isCompact ? '2px 4px' : '4px', borderLeft: isPro ? '3px solid #22c55e' : 'none', background: isPro ? 'rgba(34, 197, 94, 0.05)' : 'transparent' }}
								onClick={() => toggleCategory(cat)}
							>
								<div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
									<span style={{ transform: collapsedCategories[cat] ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', fontSize: '10px', opacity: 0.6 }}>▼</span>
									<span style={{ color: isPro ? '#22c55e' : 'inherit', fontWeight: isPro ? 700 : 600 }}>{t(`categories.${cat}`)} {isPro && '🔥'}</span>
								</div>
								<span style={{ fontSize: '10px', opacity: 0.6 }}>{tools.length}</span>
							</div>
							{!collapsedCategories[cat] && (
								<div onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, cat)} style={{ ...commonStyles.toolGrid as any, gap: isCompact ? '4px' : '8px', gridTemplateColumns: isCompact ? 'repeat(auto-fill, minmax(64px, 1fr))' : 'repeat(auto-fill, minmax(72px, 1fr))' }}>
									{tools.map(tool => (
										<LauncherToolItem key={tool.id} tool={tool} settings={settings} isCompact={isCompact} showLabels={settings?.showToolLabels ?? true} draggingId={draggingId} onSelect={onSelectTool} onTogglePin={onTogglePin} onDragStart={onDragStart} onDragOver={(e) => { e.preventDefault(); onDragEnter(cat, tool.id); }} onDrop={(e) => e.preventDefault()} isRunning={openTools.includes(tool.id as ToolId)} />
									))}
								</div>
							)}
						</div>
					);
				})}
				{!isCompact && <div style={{ ...commonStyles.footer as any, marginTop: '20px' }}><span>🔒 {t('footer.zeroTracking')}</span><span>•</span><span>💾 {t('footer.localOnly')}</span><span>•</span><span>🛠️ {visibleTools.filter(t => !t.system && t.id !== 'permissions').length} {t('common.tools')}</span></div>}
			</div>
		</div>
	);
};
