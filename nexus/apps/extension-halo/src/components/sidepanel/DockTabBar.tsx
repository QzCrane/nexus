// goal: macOS Dock-style tab bar with proper overflow handling
// eff: Horizontal scroll + upward magnification without clipping

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from '../../i18n';
import type { ToolId, ToolMeta } from '../../kernel';

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
// Space needed above icons for magnification (icon grows upward from bottom)
const MAGNIFY_HEADROOM = Math.ceil(BASE_SIZE * (MAX_SCALE - 1));

export const DockTabBar: React.FC<DockTabBarProps> = ({
	openTools, activeTool, visibleTools, onSelectTool, onCloseTool,
}) => {
	const { t } = useTranslation();
	const containerRef = useRef<HTMLDivElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const [mouseX, setMouseX] = useState<number | null>(null);
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

	// Register wheel handler with { passive: false } to allow preventDefault
	// Must re-register when dockTools changes (ref might be null initially)
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;

		const handleWheel = (e: WheelEvent) => {
			// Only intercept if we have horizontal overflow
			if (el.scrollWidth <= el.clientWidth) return;
			e.preventDefault();
			e.stopPropagation();
			// Convert both deltaY and deltaX to horizontal scroll
			el.scrollLeft += e.deltaY !== 0 ? e.deltaY : e.deltaX;
		};

		el.addEventListener('wheel', handleWheel, { passive: false });
		return () => el.removeEventListener('wheel', handleWheel);
	}, [dockTools.length]); // Re-bind when tool count changes

	if (dockTools.length === 0) return null;

	// Layout strategy to avoid parent overflow:hidden clipping:
	// - Outer wrapper: has negative marginTop to "pull up" into header space
	// - Inner container: has positive paddingTop to create visual space
	// - This keeps magnified icons WITHIN the SidePanel's visible area
	return (
		<div
			ref={containerRef}
			style={{
				position: 'relative',
				zIndex: 10, // Above header for magnification
				background: 'var(--halo-bg-secondary)',
				borderBottom: '1px solid var(--halo-border)',
				// Negative margin pulls this container UP into header area
				marginTop: `-${MAGNIFY_HEADROOM}px`,
				// Positive padding creates internal space for magnification
				paddingTop: `${MAGNIFY_HEADROOM}px`,
				paddingBottom: '8px',
			}}
		>
			<div
				ref={scrollRef}
				className="halo-thin-scrollbar"
				onMouseMove={(e) => setMouseX(e.clientX)}
				onMouseLeave={() => { setMouseX(null); setHoveredId(null); }}
				style={{
					display: 'flex',
					alignItems: 'flex-end', // Bottom-align: icons grow upward
					justifyContent: dockTools.length <= 5 ? 'center' : 'flex-start',
					gap: '6px',
					padding: '0 16px',
					overflowX: 'auto',
					overflowY: 'hidden', // Must be hidden, visible + auto causes browser quirks
					minHeight: `${BASE_SIZE}px`,
				}}
			>
				{dockTools.map((toolId, index) => {
					const tool = visibleTools.find((m) => m.id === toolId);
					if (!tool) return null;
					const isActive = activeTool === toolId;
					const isHovered = hoveredId === toolId;
					const scale = getScale(index);

					return (
						<div
							key={toolId}
							data-dock-item
							onMouseEnter={() => setHoveredId(toolId)}
							onMouseLeave={() => setHoveredId(null)}
							onClick={() => onSelectTool(toolId)}
							title={t(`tools.${tool.id}.name`)}
							style={{
								position: 'relative',
								cursor: 'pointer',
								flexShrink: 0,
								// Wrapper maintains layout space, doesn't transform
								width: `${BASE_SIZE}px`,
								height: `${BASE_SIZE}px`,
							}}
						>
							{/* Visual icon: transforms independently */}
							<div style={{
								position: 'absolute',
								left: 0,
								bottom: 0,
								width: `${BASE_SIZE}px`,
								height: `${BASE_SIZE}px`,
								transition: 'transform 0.12s cubic-bezier(0.34, 1.56, 0.64, 1)',
								transform: `scale(${scale})`,
								transformOrigin: 'center bottom', // Magnify upward from bottom
							}}>
								<div style={{
									width: '100%',
									height: '100%',
									borderRadius: '10px',
									background: isActive 
										? 'linear-gradient(145deg, #8b5cf6, #6d28d9)' 
										: 'var(--halo-bg-tertiary)',
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									fontSize: '20px',
									boxShadow: isActive 
										? '0 3px 12px rgba(124,58,237,0.5)' 
										: '0 1px 4px rgba(0,0,0,0.2)',
									border: isActive ? 'none' : '1px solid var(--halo-border)',
								}}>
									{tool.icon}
								</div>

								{/* Close button */}
								{isHovered && (
									<button
										onClick={(e) => { e.stopPropagation(); onCloseTool(toolId); }}
										style={{
											position: 'absolute',
											top: '-5px',
											right: '-5px',
											width: '16px',
											height: '16px',
											borderRadius: '50%',
											background: '#ef4444',
											border: '2px solid var(--halo-bg-secondary)',
											color: 'white',
											fontSize: '10px',
											fontWeight: 'bold',
											lineHeight: 1,
											cursor: 'pointer',
											display: 'flex',
											alignItems: 'center',
											justifyContent: 'center',
										}}
									>×</button>
								)}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
};
