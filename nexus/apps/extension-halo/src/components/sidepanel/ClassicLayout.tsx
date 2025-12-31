// goal: Classic "Toolbar Top + Content Bottom" layout

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from '../../i18n';
import type { ToolId } from '../../kernel/types';
import { ToolPanelRenderer } from '../tool-panel-renderer';
import { commonStyles } from './layouts.styles';
import type { LayoutProps } from './types';
import { ScrollbarStyles, ClassicHeader, ClassicFooter, OverlayPanel } from './classic-layout-parts';

const MIN_HEIGHT_LABELS = 66;
const MIN_HEIGHT_ICONS = 52;

export const ClassicLayout: React.FC<LayoutProps & { onToggleMode: () => void }> = ({
	activeTool,
	onSelectTool,
	settings,
	onSettingsChange,
	visibleTools,
	onToggleMode,
}) => {
	const { t } = useTranslation();
	const showLabels = settings?.showToolLabels ?? true;
	const accentColor = settings?.accentColor || '#7c3aed';
	const toolbarRef = useRef<HTMLDivElement>(null);

	const minHeight = showLabels ? MIN_HEIGHT_LABELS : MIN_HEIGHT_ICONS;
	const [toolbarHeight, setToolbarHeight] = useState(120);
	const isResizing = useRef(false);

	const handleMouseDown = useCallback((e: React.MouseEvent) => {
		isResizing.current = true;
		document.body.style.cursor = 'row-resize';
		document.body.style.userSelect = 'none';
		e.preventDefault();
	}, []);

	useEffect(() => {
		if (toolbarHeight < minHeight) setToolbarHeight(minHeight);
	}, [showLabels, minHeight, toolbarHeight]);

	useEffect(() => {
		const handleMouseMove = (e: MouseEvent) => {
			if (!isResizing.current) return;
			const contentHeight = toolbarRef.current?.scrollHeight || 1000;
			const maxWindowHeight = window.innerHeight * 0.7;
			const effectiveMaxHeight = Math.min(contentHeight, maxWindowHeight);
			const newHeight = e.clientY - 44;
			if (newHeight < minHeight) setToolbarHeight(minHeight);
			else if (newHeight > effectiveMaxHeight) setToolbarHeight(effectiveMaxHeight);
			else setToolbarHeight(newHeight);
		};

		const handleMouseUp = () => {
			isResizing.current = false;
			document.body.style.cursor = 'default';
			document.body.style.userSelect = '';
		};

		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);
		return () => {
			window.removeEventListener('mousemove', handleMouseMove);
			window.removeEventListener('mouseup', handleMouseUp);
		};
	}, [minHeight]);

	const toggleLabels = () => {
		if (settings) onSettingsChange({ ...settings, showToolLabels: !showLabels });
	};

	const moduleStore = visibleTools.find((tool) => tool.id === 'module-store');
	const toolsToShow = visibleTools.filter((tool) => tool.id !== 'module-store' && tool.id !== 'settings');

	const isOverlayTool = activeTool === 'module-store' || activeTool === 'settings';

	return (
		<div style={commonStyles.container}>
			<ScrollbarStyles />
			
			{/* Overlay for specific tools to match Launcher behavior */}
			<OverlayPanel
				activeTool={activeTool}
				visible={isOverlayTool}
				onBack={() => onSelectTool(null as unknown as ToolId)}
				onSettingsChange={onSettingsChange}
				t={t}
			/>

			<ClassicHeader
				showLabels={showLabels}
				onToggleLabels={toggleLabels}
				onToggleMode={onToggleMode}
				onSelectTool={onSelectTool}
				moduleStoreIcon={moduleStore?.icon}
				t={t}
			/>

			{/* Toolbar */}
			<div
				ref={toolbarRef}
				className="halo-scrollbar"
				style={{
					...commonStyles.toolbar,
					display: 'grid',
					gridTemplateColumns: `repeat(auto-fill, minmax(${showLabels ? '80px' : '40px'}, 1fr))`,
					gridAutoRows: 'max-content',
					padding: '8px',
					flexShrink: 0,
					height: `${toolbarHeight}px`,
					borderBottom: 'none',
					gap: '4px',
					alignContent: 'start',
					overflowY: 'auto',
					transition: isResizing.current ? 'none' : 'height 0.2s cubic-bezier(0.2, 0, 0, 1)',
				}}
			>
				{toolsToShow.map((tool) => {
					const isReady = tool.status === 'ready' || tool.status === 'beta';
					const isActive = activeTool === tool.id;
					return (
						<button
							key={tool.id}
							onClick={() => isReady && onSelectTool(tool.id as ToolId)}
							disabled={!isReady}
							style={{
								...commonStyles.toolBtn,
								minHeight: showLabels ? 'auto' : '36px',
								height: showLabels ? 'auto' : '36px',
								flexShrink: 0,
								aspectRatio: showLabels ? 'auto' : '1/1',
								padding: '4px',
								background: isActive ? `${accentColor}20` : 'transparent',
								borderColor: isActive ? accentColor : 'transparent',
								opacity: isReady ? 1 : 0.4,
								cursor: isReady ? 'pointer' : 'not-allowed',
							}}
							title={t(`tools.${tool.id}.name`)}
						>
							<span style={{ fontSize: '18px' }}>{tool.icon}</span>
							{showLabels && (
								<span
									style={{
										fontSize: '9px',
										marginTop: '2px',
										color: 'var(--halo-text-muted, #999)',
										width: '100%',
										whiteSpace: 'nowrap',
										overflow: 'hidden',
										textOverflow: 'ellipsis',
										textAlign: 'center',
									}}
								>
									{t(`tools.${tool.id}.name`)}
								</span>
							)}
						</button>
					);
				})}
			</div>

			<div style={commonStyles.resizeHandle} onMouseDown={handleMouseDown}>
				<div style={commonStyles.resizeHandleIcon} />
			</div>

			{/* Content - Hide if overlay tool is active */}
			<div className="halo-scrollbar" style={{ ...commonStyles.content, overflowY: 'auto', opacity: isOverlayTool ? 0 : 1 }}>
				<ToolPanelRenderer 
					activeTool={isOverlayTool ? null : activeTool} 
					onSettingsChange={onSettingsChange} 
					selectToolText={t('common.selectTool')} 
				/>
			</div>

			<ClassicFooter t={t} />
		</div>
	);
};
