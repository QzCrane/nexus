// goal: macOS Dock-style tab bar with proper overflow handling
// eff: Horizontal scroll + upward magnification without clipping

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from '../../i18n';
import type { ToolId, ToolMeta } from '../../kernel';
import { useSmoothWheel } from '../../kernel/hooks/use-smooth-wheel';
import { DockItem } from './DockItem';

interface DockTabBarProps {
	openTools: ToolId[];
	activeTool: ToolId | null;
	visibleTools: ToolMeta[];
	onSelectTool: (id: ToolId) => void;
	onCloseTool: (id: ToolId) => void;
}

const BASE_SIZE = 38;
const MAX_SCALE = 1.4;
const EFFECT_DISTANCE = 70;
const MAGNIFY_HEADROOM = Math.ceil(BASE_SIZE * (MAX_SCALE - 1));
const TOOLTIP_DELAY = 300;

export const DockTabBar: React.FC<DockTabBarProps> = ({
	openTools, activeTool, visibleTools, onSelectTool, onCloseTool,
}) => {
	const { t } = useTranslation();
	const scrollRef = useRef<HTMLDivElement>(null);
	const [mouseX, setMouseX] = useState<number | null>(null);
	const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
	const tooltipTimer = useRef<number | null>(null);
	const [hoveredId, setHoveredId] = useState<ToolId | null>(null);

	const dockTools = openTools.filter((id) => {
		const tool = visibleTools.find((m) => m.id === id);
		return tool && !tool.system && id !== 'settings' && id !== 'module-store' && id !== 'permissions';
	});

	const getScale = useCallback((index: number) => {
		if (mouseX === null || !scrollRef.current) return 1;
		const items = scrollRef.current.querySelectorAll('[data-dock-item]');
		const item = items[index] as HTMLElement;
		if (!item) return 1;
		const rect = item.getBoundingClientRect();
		const dist = Math.abs(mouseX - (rect.left + rect.width / 2));
		if (dist > EFFECT_DISTANCE) return 1;
		const ratio = 1 - dist / EFFECT_DISTANCE;
		return 1 + ratio * ratio * (MAX_SCALE - 1);
	}, [mouseX]);

	useSmoothWheel(scrollRef, 'x');

	const handleItemEnter = useCallback((toolId: ToolId, toolName: string, rect: DOMRect) => {
		setHoveredId(toolId);
		if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
		tooltipTimer.current = window.setTimeout(() => {
			setTooltip({ text: toolName, x: rect.left + rect.width / 2, y: rect.top - 10 });
		}, TOOLTIP_DELAY);
	}, []);

	const handleItemLeave = useCallback(() => {
		setHoveredId(null);
		if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
		setTooltip(null);
	}, []);

	if (dockTools.length === 0) return null;

	return (
		<div style={{
			position: 'relative',
			zIndex: 100, 
			background: 'transparent',
			// 将 Dock 向上提到 Header 底部边缘，给放大留出空间
			marginTop: `-${MAGNIFY_HEADROOM}px`,
			pointerEvents: 'none',
		}}>
			<style>{`
				@keyframes dockTooltipFadeIn {
					from { opacity: 0; transform: translate(-50%, -90%) scale(0.95); }
					to { opacity: 1; transform: translate(-50%, -100%) scale(1); }
				}
			`}</style>

			{/* 背景层：仅覆盖底部 Dock 条区域，顶部位移与负 margin 抵消 */}
			<div style={{
				position: 'absolute',
				bottom: 0,
				left: 0,
				right: 0,
				top: `${MAGNIFY_HEADROOM}px`, // 从 magnification 区域下方开始
				background: 'var(--halo-bg-secondary)',
				borderBottom: '1px solid var(--halo-border)',
				zIndex: -1,
				pointerEvents: 'auto',
			}} />
			
			<div
				ref={scrollRef}
				className="halo-thin-scrollbar"
				onMouseMove={(e) => setMouseX(e.clientX)}
				onMouseLeave={() => { setMouseX(null); setHoveredId(null); setTooltip(null); }}
				style={{
					display: 'flex',
					alignItems: 'flex-end',
					justifyContent: dockTools.length <= 5 ? 'center' : 'flex-start',
					gap: '6px',
					padding: '0 16px 8px 16px', // 底部留 8px 边距
					overflowX: 'auto',
					overflowY: 'hidden', // 关键：现在高度足够，不会切掉顶部
					// 总高度 = 图标高 + 放大余量 + 底部 padding
					minHeight: `${BASE_SIZE + MAGNIFY_HEADROOM + 8}px`,
					pointerEvents: 'auto',
				}}
			>
				{dockTools.map((toolId, index) => {
					const tool = visibleTools.find((m) => m.id === toolId);
					if (!tool) return null;
					return (
						<DockItem
							key={toolId}
							tool={tool}
							isActive={activeTool === toolId}
							isHovered={hoveredId === toolId}
							scale={getScale(index)}
							baseSize={BASE_SIZE}
							onMouseEnter={(e) => handleItemEnter(toolId, t(`tools.${tool.id}.name`), e.currentTarget.getBoundingClientRect())}
							onMouseLeave={handleItemLeave}
							onClick={() => onSelectTool(toolId)}
							onClose={() => onCloseTool(toolId)}
						/>
					);
				})}
			</div>

			{/* Custom Tooltip - Portal to body to escape stacking context */}
			{tooltip && createPortal(
				<div style={{
					position: 'fixed',
					left: tooltip.x,
					top: tooltip.y,
					transform: 'translate(-50%, -100%)',
					background: 'rgba(0, 0, 0, 0.8)',
					backdropFilter: 'blur(8px)',
					color: 'white',
					padding: '5px 10px',
					borderRadius: '6px',
					fontSize: '12px',
					fontWeight: 500,
					whiteSpace: 'nowrap',
					pointerEvents: 'none',
					zIndex: 99999,
					boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
					animation: 'dockTooltipFadeIn 0.1s ease-out forwards',
				}}>
					{tooltip.text}
				</div>,
				document.body
			)}
		</div>
	);
};
