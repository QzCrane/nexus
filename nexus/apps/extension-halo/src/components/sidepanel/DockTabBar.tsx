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
// 增加冗余高度，确保红色删除按钮和阴影不被裁剪
const MAGNIFY_HEADROOM = 24; 
const TOOLTIP_DELAY = 100;

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

	const handleItemEnter = useCallback((toolId: ToolId, toolName: string, rect: DOMRect) => {
		setHoveredId(toolId);
		if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
		tooltipTimer.current = window.setTimeout(() => {
			// Position tooltip below the icon
			setTooltip({ text: toolName, x: rect.left + rect.width / 2, y: rect.bottom + 8 });
		}, TOOLTIP_DELAY);
	}, []);

	const handleItemLeave = useCallback(() => {
		setHoveredId(null);
		if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
		setTooltip(null);
	}, []);

	// 重构滚轮逻辑：直接绑定在滚动容器上，确保能够接收到事件
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;

		const handleWheel = (e: WheelEvent) => {
			// 如果是垂直滚动，则接管并转换为水平位移
			if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
				// 判定溢出状态
				if (el.scrollWidth > el.clientWidth + 1) {
					e.preventDefault();
					e.stopPropagation();

					let delta = e.deltaY;
					if (e.deltaMode === 1) delta *= 40; 
					else if (e.deltaMode === 2) delta *= el.clientWidth;

					el.scrollLeft += delta;
				}
			}
		};

		el.addEventListener('wheel', handleWheel, { passive: false });
		return () => el.removeEventListener('wheel', handleWheel);
	}, [dockTools.length]); // 工具数量变化时重新绑定（虽然引用一致，但为了保险）

	if (dockTools.length === 0) return null;

	// 实现完美居中的仿真 Padding
	const isShort = dockTools.length <= 5;
	const iconTotalWidth = dockTools.length * (BASE_SIZE + 6); // 38px size + 6px gap

	return (
		<div style={{
			position: 'relative',
			zIndex: 1000, // 强制提升至顶级，防止被 Header 裁剪
			background: 'transparent',
			// 将负 Margin 移除，改用相对定位来覆盖 Header，这样不会影响 pointer-events 命中
			marginTop: `-${MAGNIFY_HEADROOM}px`,
		}}>
			<style>{`
				@keyframes dockTooltipFadeIn {
					from { opacity: 0; transform: translate(-50%, -10px) scale(0.95); }
					to { opacity: 1; transform: translate(-50%, 0) scale(1); }
				}
				.dock-scroll-container::before {
					content: '';
					margin-left: auto;
					flex-shrink: 0;
				}
				.dock-scroll-container::after {
					content: '';
					margin-right: auto;
					flex-shrink: 0;
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
					justifyContent: 'flex-start',
					gap: '6px',
					padding: `0 16px 8px 16px`,
					// 只有在内容较少时才开启仿真居中
					paddingLeft: isShort ? `calc(50% - ${iconTotalWidth / 2}px)` : '16px',
					overflowX: 'auto',
					overflowY: 'hidden',
					minHeight: `${BASE_SIZE + MAGNIFY_HEADROOM + 12}px`, // 加一点点底垫
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

			{/* Tooltip: Portal to body for absolute escape */}
			{tooltip && createPortal(
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
