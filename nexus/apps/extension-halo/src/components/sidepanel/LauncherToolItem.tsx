import React, { useState, memo, useCallback } from 'react';
import type { ToolId, ToolMeta, HaloSettings } from '../../kernel';
import { toggleScriptTool } from '../../kernel';
import { useTranslation } from '../../i18n';
import { commonStyles } from './layouts.styles';
import { useToolEngineStatus } from './hooks/use-tool-engine-status';
import { getCategoryColor, StatusIndicators, PinOverlay, ToolAnimations } from './LauncherToolItemParts';

interface LauncherToolItemProps {
	tool: ToolMeta;
	settings: HaloSettings | null;
	iconSize: number;
	spacing: number;
	showLabels: boolean;
	draggingId: string | null;
	onSelect: (id: ToolId) => void;
	onTogglePin: (id: string) => void;
	onDragStart: (e: React.DragEvent, id: string) => void;
	onDragOver: (e: React.DragEvent) => void;
	onDrop: (e: React.DragEvent, targetId: string) => void;
	isRunning: boolean;
	serviceState?: 'active' | 'inactive';
	/** SaaT: callback for script tools toggle (instead of onSelect) */
	onToggleScript?: (tool: ToolMeta) => void;
}

export const LauncherToolItem: React.FC<LauncherToolItemProps> = memo(({
	tool, settings, iconSize, spacing, showLabels, draggingId,
	onSelect, onTogglePin, onDragStart, onDragOver, onDrop, isRunning, serviceState,
	onToggleScript
}) => {
	const { t } = useTranslation();
	const [isHovered, setIsHovered] = useState(false);
	const [isPinHovered, setIsPinHovered] = useState(false);
	
	const isReady = tool.status === 'ready' || tool.status === 'beta';
	const isPinned = settings?.pinnedTools?.includes(tool.id);
	const isDragging = draggingId === tool.id;
	const isScriptTool = tool.toolType === 'script';
	// isRunning is now passed as a prop
	const engineEnabled = useToolEngineStatus(tool.id);
	const mainThemeColor = getCategoryColor(tool.category);

	const handleTogglePin = (e: React.MouseEvent) => {
		e.stopPropagation();
		onTogglePin(tool.id);
	};

	// SaaT: Default script toggle handler
	const handleScriptToggle = useCallback(async () => {
		if (!isScriptTool) return;
		if (onToggleScript) {
			onToggleScript(tool);
		} else {
			await toggleScriptTool(tool);
		}
	}, [isScriptTool, onToggleScript, tool]);

	const fontSize = `${iconSize}px`;
	const padding = Math.max(4, spacing / 2) + 'px';
	
	// Dynamic pin overlay logic needed since isCompact prop is gone
	// We can infer compactness if padding/spacing is small, but PinOverlay mainly just needs size info?
	// Actually PinOverlay uses isCompact to select size.
	// Let's pass `isCompact` as (iconSize < 24) or (spacing < 8) to PinOverlay for now as fallback
	const _inferredCompact = iconSize < 24;

	return (
		<div
			draggable={isReady}
			onDragStart={(e) => onDragStart(e, tool.id)}
			onDragOver={onDragOver}
			onDrop={(e) => onDrop(e, tool.id)}
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => { setIsHovered(false); setIsPinHovered(false); }}
			style={{ 
				position: 'relative', opacity: isDragging ? 0.4 : 1, width: '100%',
				transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
				zIndex: isHovered ? 10 : 1,
				transform: isHovered && isReady ? 'translateY(-2px)' : 'none'
			}}
		>
			<button
				data-tool-id={tool.id}
				data-tool-type={isScriptTool ? 'script' : 'panel'}
				onClick={() => {
					if (!isReady) return;
					if (isScriptTool) {
						handleScriptToggle();
					} else {
						onSelect(tool.id as ToolId);
					}
				}}
				onContextMenu={(e) => { e.preventDefault(); onTogglePin(tool.id); }}
				disabled={!isReady}
				style={{
					...commonStyles.toolBtn as React.CSSProperties,
					aspectRatio: '1/1', height: 'auto', width: '100%',
					opacity: isReady ? 1 : 0.3, cursor: isReady ? 'grab' : 'not-allowed',
					padding: padding,
					border: isPinned ? `1.5px solid ${mainThemeColor}` : isHovered && isReady ? `1.5px solid ${mainThemeColor}44` : '1px solid var(--halo-border)',
					background: isPinned ? `linear-gradient(135deg, var(--halo-bg-secondary), ${mainThemeColor}08)` : 'var(--halo-bg-tertiary)',
					boxShadow: isPinned ? `0 4px 12px ${mainThemeColor}25` : isHovered && isReady ? '0 6px 20px rgba(0,0,0,0.35)' : 'none',
					borderRadius: '12px', overflow: 'visible', transition: 'all 0.2s ease', position: 'relative'
				}}
				title={isReady ? `${t(`tools.${tool.id}.name`)}\n${t('common.pinHint')}` : `${t(`tools.${tool.id}.name`)} (${t('common.comingSoon')})`}
			>
				<StatusIndicators isRunning={isRunning} engineEnabled={engineEnabled} serviceState={serviceState} />

				{/* Category Accent Line */}
				<div style={{ 
					position: 'absolute', bottom: '6px', left: '25%', right: '25%', 
					height: '2.5px', borderRadius: '2px', background: mainThemeColor,
					opacity: isHovered || isPinned ? 0.9 : 0.3, transition: 'opacity 0.2s',
					boxShadow: isPinned || isHovered ? `0 0 6px ${mainThemeColor}66` : 'none'
				}} />

				<span style={{ 
					...commonStyles.toolIcon as React.CSSProperties, 
					fontSize: fontSize,
					marginBottom: '4px',
					transition: 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
					transform: isHovered ? 'scale(1.15)' : 'scale(1)'
				}}>{tool.icon}</span>

				{showLabels && <span style={{ 
					...commonStyles.toolLabel as React.CSSProperties, 
					fontSize: iconSize < 24 ? '10px' : '11px', color: isPinned ? 'var(--halo-text)' : 'var(--halo-text-muted)',
					fontWeight: isPinned ? 600 : 400
				}}>{t(`tools.${tool.id}.name`)}</span>}
				
				{(isPinned || (isHovered && isReady)) && (
					<PinOverlay 
						isPinned={!!isPinned} isPinHovered={isPinHovered} isCompact={_inferredCompact} 
						onToggle={handleTogglePin} onMouseEnter={() => setIsPinHovered(true)} onMouseLeave={() => setIsPinHovered(false)} 
					/>
				)}
			</button>
			<ToolAnimations />
		</div>
	);
});
