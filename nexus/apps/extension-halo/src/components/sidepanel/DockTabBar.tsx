// goal: macOS Dock-style tab bar with proper overflow handling
// eff: Horizontal scroll + upward magnification without clipping
// note: Centering items when few, scrolling when many. Tooltip at bottom.

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
// 增加冗余高度至 30px，确保红色删除按钮和图标放大后完全显示
const MAGNIFY_HEADROOM = 30; 
const TOOLTIP_DELAY = 100;

import { useActiveServices } from './ActiveServicesContext';

export const DockTabBar: React.FC<DockTabBarProps> = ({
	openTools, activeTool, visibleTools, onSelectTool, onCloseTool
}) => {
	const { t } = useTranslation();
	const { activeServices, bgToolIds } = useActiveServices();
	const scrollRef = useRef<HTMLDivElement>(null);
	const [mouseX, setMouseX] = useState<number | null>(null);
	const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
	const tooltipTimer = useRef<number | null>(null);
	const [hoveredId, setHoveredId] = useState<ToolId | null>(null);

	// 应用平滑滚动 Hook
	useSmoothWheel(scrollRef, 'x');

	const dockTools = openTools.filter((id) => {
		const tool = visibleTools.find((m) => m.id === id);
		return tool && tool.pluginType !== 'system';
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
			setTooltip({ text: toolName, x: rect.left + rect.width / 2, y: rect.bottom + 10 });
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
			zIndex: 1000,
			background: 'transparent',
			marginTop: `-${MAGNIFY_HEADROOM}px`,
			overflow: 'visible',
			pointerEvents: 'none', // 允许点击穿透到下方的 Header
		}}>
			<style>{`
				@keyframes dockTooltipFadeIn {
					from { opacity: 0; transform: translate(-50%, -10px) scale(0.95); }
					to { opacity: 1; transform: translate(-50%, 0) scale(1); }
				}
				.dock-scroll-container::before,
				.dock-scroll-container::after {
					content: '';
					margin: auto;
					flex-shrink: 0;
					width: 16px; 
				}
			`}</style>
			
			<div
				ref={scrollRef}
				className="halo-thin-scrollbar dock-scroll-container"
				onMouseMove={(e) => {
					// 由于容器是 pointer-events: none, 此事件仅由 auto 类型的子元素（图标或背景区）冒泡触发
					setMouseX(e.clientX);
				}}
				onMouseLeave={() => { setMouseX(null); setHoveredId(null); setTooltip(null); }}
				style={{
					display: 'flex',
					alignItems: 'flex-end',
					justifyContent: 'flex-start',
					gap: '6px',
					padding: `0 0 8px 0`,
					overflowX: 'auto',
					overflowY: 'hidden',
					minHeight: `${BASE_SIZE + MAGNIFY_HEADROOM + 12}px`,
					pointerEvents: 'none', // 整个滚动层默认穿透，由子元素控制感应
					position: 'relative',
				}}
			>
				{/* Background Hit Area: 仅覆盖底部 Dock 条，用于捕获滚轮和间隙点击 */}
				<div style={{
					position: 'absolute',
					left: 0,
					top: MAGNIFY_HEADROOM,
					right: 0,
					bottom: 0,
					background: 'var(--halo-bg-secondary)',
					pointerEvents: 'auto',
					zIndex: -1,
					borderBottom: '1px solid var(--halo-border)',
				}} />

				{dockTools.map((toolId, index) => {
					const tool = visibleTools.find((m) => m.id === toolId);
					if (!tool) return null;
					
					const isActiveService = activeServices.has(toolId);
					const isBackgroundCapable = bgToolIds.includes(toolId);
					const serviceState = isActiveService ? 'active' : (isBackgroundCapable ? 'inactive' : undefined);

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
							serviceState={serviceState}
						/>
					);
				})}
			</div>

			{/* Tooltip: Portal to body for absolute escape */}
			{/* Only render when actually hovering - prevents stale tooltip from appearing */}
			{tooltip && hoveredId !== null && createPortal(
				<div style={{
					position: 'fixed',
					left: tooltip.x,
					top: tooltip.y,
					transform: 'translate(-50%, 0)',
					background: 'rgba(20, 20, 20, 0.9)',
					backdropFilter: 'blur(12px)',
					color: 'white',
					padding: '5px 12px',
					borderRadius: '8px',
					fontSize: '11px',
					fontWeight: 500,
					whiteSpace: 'nowrap',
					pointerEvents: 'none',
					zIndex: 999999,
					boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
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
