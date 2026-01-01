// goal: macOS Dock-style tab bar with proper overflow handling
// eff: Horizontal scroll + upward magnification without clipping
// note: Centering items when few, scrolling when many. Tooltip at bottom.

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from '../../i18n';
import type { ToolId, ToolMeta } from '../../kernel';
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
const TOOLTIP_DELAY = 100;

export const DockTabBar: React.FC<DockTabBarProps> = ({
	openTools, activeTool, visibleTools, onSelectTool, onCloseTool,
}) => {
	const { t } = useTranslation();
	const scrollRef = useRef<HTMLDivElement>(null);
	const outerRef = useRef<HTMLDivElement>(null); // Added outer ref for better capture
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

	const handleItemEnter = useCallback((toolId: ToolId, toolName: string, rect: DOMRect) => {
		setHoveredId(toolId);
		if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
		tooltipTimer.current = window.setTimeout(() => {
			// POSITION: BOTTOM (rect.bottom + 8)
			setTooltip({ text: toolName, x: rect.left + rect.width / 2, y: rect.bottom + 8 });
		}, TOOLTIP_DELAY);
	}, []);

	const handleItemLeave = useCallback(() => {
		setHoveredId(null);
		if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
		setTooltip(null);
	}, []);

	// ROBUST WHEEL LOGIC: Attach to outer container to capture everything
	useEffect(() => {
		const outer = outerRef.current;
		const inner = scrollRef.current;
		if (!outer || !inner) return;

		const handleWheel = (e: WheelEvent) => {
			// Even if internal deltaX/Y are small, we might need to intercept
			if (Math.abs(e.deltaY) > Math.abs(e.deltaX) * 0.5) {
				const isScrollable = inner.scrollWidth > inner.clientWidth + 0.5;
				if (isScrollable) {
					e.preventDefault();
					e.stopPropagation();

					let delta = e.deltaY;
					if (e.deltaMode === 1) delta *= 38; // Match icon size
					else if (e.deltaMode === 2) delta *= inner.clientWidth;

					inner.scrollLeft += delta;
				}
			}
		};

		outer.addEventListener('wheel', handleWheel, { passive: false });
		return () => outer.removeEventListener('wheel', handleWheel);
	}, []);

	if (dockTools.length === 0) return null;

	return (
		<div 
			ref={outerRef}
			style={{
				position: 'relative',
				zIndex: 100, 
				background: 'transparent',
				marginTop: `-${MAGNIFY_HEADROOM}px`,
				pointerEvents: 'none',
			}}
		>
			<style>{`
				@keyframes dockTooltipFadeIn {
					from { opacity: 0; transform: translate(-50%, -8px) scale(0.95); }
					to { opacity: 1; transform: translate(-50%, 0) scale(1); }
				}
				.dock-scroll-container::before {
					content: '';
					margin-left: auto;
				}
				.dock-scroll-container::after {
					content: '';
					margin-right: auto;
				}
			`}</style>
			
			<div
				ref={scrollRef}
				className="halo-thin-scrollbar dock-scroll-container"
				onMouseMove={(e) => setMouseX(e.clientX)}
				onMouseLeave={() => { setMouseX(null); setHoveredId(null); setTooltip(null); }}
				style={{
					display: 'flex',
					alignItems: 'flex-end',
					// FIX: Use flex-start to enable scrollLeft, use margin:auto items (via psuedo) for centering
					justifyContent: 'flex-start',
					gap: '6px',
					padding: '0 16px 8px 16px',
					overflowX: 'auto',
					overflowY: 'hidden',
					minHeight: `${BASE_SIZE + MAGNIFY_HEADROOM + 8}px`,
					pointerEvents: 'auto',
					position: 'relative',
					background: `linear-gradient(to bottom, transparent ${MAGNIFY_HEADROOM}px, var(--halo-bg-secondary) ${MAGNIFY_HEADROOM}px)`,
					borderBottom: '1px solid var(--halo-border)',
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

			{/* Custom Tooltip - RENDER AT BOTTOM */}
			{tooltip && createPortal(
				<div style={{
					position: 'fixed',
					left: tooltip.x,
					top: tooltip.y,
					transform: 'translate(-50%, 0)',
					background: 'rgba(20, 20, 20, 0.85)',
					backdropFilter: 'blur(10px)',
					color: 'white',
					padding: '4px 10px',
					borderRadius: '6px',
					fontSize: '11px',
					fontWeight: 500,
					whiteSpace: 'nowrap',
					pointerEvents: 'none',
					zIndex: 99999,
					boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
					animation: 'dockTooltipFadeIn 0.08s ease-out forwards',
					border: '1px solid rgba(255, 255, 255, 0.1)',
				}}>
					{tooltip.text}
				</div>,
				document.body
			)}
		</div>
	);
};
