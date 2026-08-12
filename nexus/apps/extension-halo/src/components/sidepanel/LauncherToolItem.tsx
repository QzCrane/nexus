import type React from 'react';
import { useState, memo } from 'react';
import type { ToolId, ToolMeta, HaloSettings } from '../../kernel';
import { useTranslation } from '../../i18n';
import { commonStyles } from './layouts.styles';
import { getCategoryColor, StatusIndicators, PinOverlay } from './LauncherToolItemParts';
import { useToolPreload } from '../core/lazy-tool-loader';

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
	onEditScript?: (scriptId: string) => void;
}

export const LauncherToolItem: React.FC<LauncherToolItemProps> = memo(({
	tool, settings, iconSize, spacing, showLabels, draggingId,
	onSelect, onTogglePin, onDragStart, onDragOver, onDrop, isRunning, serviceState,
	onEditScript
}) => {
	const { t } = useTranslation();
	const [isHovered, setIsHovered] = useState(false);
	const [isPinHovered, setIsPinHovered] = useState(false);
	const { preload, cancelPreload } = useToolPreload();
	
	const isReady = tool.status === 'ready' || tool.status === 'beta';
	const isPinned = settings?.pinnedTools?.includes(tool.id);
	const isDragging = draggingId === tool.id;
	const isScriptTool = tool.pluginType === 'script';
	const mainThemeColor = getCategoryColor(tool.category);

	const handleTogglePin = (e: React.MouseEvent) => {
		e.stopPropagation();
		onTogglePin(tool.id);
	};

	const fontSize = `${iconSize}px`;
	const padding = `${Math.max(4, spacing / 2)}px`;
	const isCompact = iconSize < 24;

	return (
		<fieldset
			aria-label={t(`tools.${tool.id}.name`, { defaultValue: tool.name })}
			onMouseEnter={() => {
				setIsHovered(true);
				if (!isScriptTool && isReady) preload(tool.id as ToolId);
			}}
			onMouseLeave={() => {
				cancelPreload();
				setIsHovered(false);
				setIsPinHovered(false);
			}}
			style={{ 
				position: 'relative', opacity: isDragging ? 0.4 : 1, width: '100%',
				border: 0, margin: 0, padding: 0, minInlineSize: 0,
				transition: 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
				zIndex: isHovered ? 10 : 1,
				transform: isHovered && isReady ? 'translateY(-2px)' : 'translateY(0)',
				willChange: isHovered && isReady ? 'transform' : 'auto',
			}}
		>
			<button type="button"
				draggable={isReady}
				onDragStart={(e) => onDragStart(e, tool.id)}
				onDragOver={onDragOver}
				onDrop={(e) => onDrop(e, tool.id)}
				data-tool-id={tool.id}
				data-tool-type={isScriptTool ? 'script' : 'panel'}
				onClick={() => {
					if (!isReady) return;
					if (isScriptTool) {
						if (onEditScript) onEditScript(tool.id);
						else onSelect('userscripts' as ToolId);
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
					padding,
					border: isPinned ? `1.5px solid ${mainThemeColor}` : isHovered && isReady ? `1.5px solid ${mainThemeColor}44` : '1px solid var(--halo-border)',
					background: isPinned ? `linear-gradient(135deg, var(--halo-bg-secondary), ${mainThemeColor}08)` : 'var(--halo-bg-tertiary)',
					boxShadow: isPinned ? `0 4px 12px ${mainThemeColor}25` : isHovered && isReady ? '0 6px 20px rgba(0,0,0,0.35)' : 'none',
					borderRadius: '12px', overflow: 'visible', transition: 'border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease', position: 'relative',
					outline: 'none',
					backfaceVisibility: 'hidden',
				}}
				title={isReady ? `${t(`tools.${tool.id}.name`, { defaultValue: tool.name })}\n${t('common.pinHint')}` : `${t(`tools.${tool.id}.name`, { defaultValue: tool.name })} (${t('common.comingSoon')})`}
			>
				<StatusIndicators toolId={tool.id} isRunning={isRunning} serviceState={serviceState} />

				<div style={{ 
					position: 'absolute', bottom: '6px', left: '25%', right: '25%', 
					height: '2.5px', borderRadius: '2px', background: mainThemeColor,
					opacity: isHovered || isPinned ? 0.9 : 0.3, transition: 'opacity 0.2s',
					boxShadow: isPinned || isHovered ? `0 0 6px ${mainThemeColor}66` : 'none'
				}} />

				<span style={{ 
					...commonStyles.toolIcon as React.CSSProperties, 
					fontSize,
					marginBottom: '4px',
					transition: 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
					transform: isHovered ? 'scale(1.15)' : 'scale(1)',
					backfaceVisibility: 'hidden'
				}}>{tool.icon}</span>

				{showLabels && <span style={{ 
					...commonStyles.toolLabel as React.CSSProperties, 
					fontSize: iconSize < 24 ? '10px' : '11px', color: isPinned ? 'var(--halo-text)' : 'var(--halo-text-muted)',
					fontWeight: isPinned ? 600 : 400
				}}>{t(`tools.${tool.id}.name`, { defaultValue: tool.name })}</span>}
			</button>
			{(isPinned || (isHovered && isReady)) && (
				<PinOverlay
					isPinned={!!isPinned} isPinHovered={isPinHovered} isCompact={isCompact}
					onToggle={handleTogglePin} onMouseEnter={() => setIsPinHovered(true)} onMouseLeave={() => setIsPinHovered(false)}
				/>
			)}
		</fieldset>
	);
});
