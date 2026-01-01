import React, { useState, useMemo } from 'react';
import type { ToolId, ToolMeta, HaloSettings } from '../../kernel';
import { useTranslation } from '../../i18n';
import { commonStyles } from './layouts.styles';

interface LauncherToolItemProps {
	tool: ToolMeta;
	settings: HaloSettings | null;
	isCompact: boolean;
	showLabels: boolean;
	draggingId: string | null;
	onSelect: (id: ToolId) => void;
	onTogglePin: (id: string) => void;
	onDragStart: (e: React.DragEvent, id: string) => void;
	onDragOver: (e: React.DragEvent) => void;
	onDrop: (e: React.DragEvent, targetId: string) => void;
	openTools: ToolId[];
}

// Environmental Tools: Features that change the browser behavior or stay active with a master toggle
const ENVIRONMENTAL_TOOLS: string[] = [
	'smooth-scroll', 'userscripts', 'clipboard'
];

export const LauncherToolItem: React.FC<LauncherToolItemProps> = ({
	tool,
	settings,
	isCompact,
	showLabels,
	draggingId,
	onSelect,
	onTogglePin,
	onDragStart,
	onDragOver,
	onDrop,
	openTools
}) => {
	const { t } = useTranslation();
	const [isHovered, setIsHovered] = useState(false);
	const [isPinHovered, setIsPinHovered] = useState(false);
	
	const isReady = tool.status === 'ready' || tool.status === 'beta';
	const isPinned = settings?.pinnedTools?.includes(tool.id);
	const isDragging = draggingId === tool.id;
	const isRunning = openTools.includes(tool.id as ToolId);
	const [engineEnabled, setEngineEnabled] = React.useState(false);

	// Category high-end color map
	const mainThemeColor = useMemo(() => {
		switch (tool.category) {
			case 'dev': return '#3b82f6'; // Blue
			case 'efficiency': return '#8b5cf6'; // Purple
			case 'visual': return '#ec4899'; // Pink
			case 'security': return '#ef4444'; // Red
			case 'browser': return '#f59e0b'; // Amber
			case 'ai': return '#10b981'; // Emerald
			case 'media': return '#06b6d4'; // Cyan
			case 'general': return '#6366f1'; // Indigo
			default: return 'var(--halo-accent)';
		}
	}, [tool.category]);

	// Track engine status for environmental tools
	React.useEffect(() => {
		const isEnv = ENVIRONMENTAL_TOOLS.includes(tool.id);
		if (!isEnv) return;

		const checkStatus = async () => {
			if (tool.id === 'smooth-scroll') {
				const data = await chrome.storage.sync.get('HALO_SMOOTH_SCROLL_SETTINGS');
				const settings = data['HALO_SMOOTH_SCROLL_SETTINGS'];
				setEngineEnabled(!!settings?.enabled);
			} else if (tool.id === 'userscripts') {
				const data = await chrome.storage.local.get('halo_userscripts');
				const state = data['halo_userscripts'];
				setEngineEnabled(!!state?.globalEnabled);
			} else if (tool.id === 'clipboard') {
				const data = await chrome.storage.local.get('halo_tool_clipboard_settings');
				const settings = data['halo_tool_clipboard_settings'];
				setEngineEnabled(settings?.enabled !== false); // Default to true
			}
		};

		checkStatus();

		const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
			if (tool.id === 'smooth-scroll' && areaName === 'sync' && changes['HALO_SMOOTH_SCROLL_SETTINGS']) {
				setEngineEnabled(!!changes['HALO_SMOOTH_SCROLL_SETTINGS'].newValue?.enabled);
			} else if (tool.id === 'userscripts' && areaName === 'local' && changes['halo_userscripts']) {
				setEngineEnabled(!!changes['halo_userscripts'].newValue?.globalEnabled);
			} else if (tool.id === 'clipboard' && areaName === 'local' && changes['halo_tool_clipboard_settings']) {
				setEngineEnabled(changes['halo_tool_clipboard_settings'].newValue?.enabled !== false);
			}
		};

		chrome.storage.onChanged.addListener(listener);
		return () => chrome.storage.onChanged.removeListener(listener);
	}, [tool.id]);

	return (
		<div
			draggable={isReady}
			onDragStart={(e) => onDragStart(e, tool.id)}
			onDragOver={onDragOver}
			onDrop={(e) => onDrop(e, tool.id)}
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => {
				setIsHovered(false);
				setIsPinHovered(false);
			}}
			style={{ 
				position: 'relative', 
				opacity: isDragging ? 0.4 : 1, 
				width: '100%',
				transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
				zIndex: isHovered ? 10 : 1,
				transform: isHovered && isReady ? 'translateY(-2px)' : 'none'
			}}
		>
			<button
				onClick={() => isReady && onSelect(tool.id as ToolId)}
				onContextMenu={(e) => {
					e.preventDefault();
					onTogglePin(tool.id);
				}}
				disabled={!isReady}
				style={{
					...commonStyles.toolBtn as React.CSSProperties,
					aspectRatio: '1/1', height: 'auto', width: '100%',
					opacity: isReady ? 1 : 0.3,
					cursor: isReady ? 'grab' : 'not-allowed',
					padding: isCompact ? '4px 2px' : '8px 4px',
					
					border: isPinned 
						? `1.5px solid ${mainThemeColor}` 
						: isHovered && isReady
							? `1.5px solid ${mainThemeColor}44`
							: '1px solid var(--halo-border)',
					background: isPinned 
						? `linear-gradient(135deg, var(--halo-bg-secondary), ${mainThemeColor}08)` 
						: 'var(--halo-bg-tertiary)',
					boxShadow: isPinned 
						? `0 4px 12px ${mainThemeColor}25` 
						: isHovered && isReady 
							? '0 6px 20px rgba(0,0,0,0.35)' 
							: 'none',
					
					borderRadius: '12px',
					overflow: 'visible',
					transition: 'all 0.2s ease',
					position: 'relative'
				}}
				title={isReady ? `${t(`tools.${tool.id}.name`)}\n${t('common.pinHint')}` : `${t(`tools.${tool.id}.name`)} (${t('common.comingSoon')})`}
			>
				{/* Top Status Indicators Layer */}
				<div style={{ 
					position: 'absolute', top: '5px', left: '6px', 
					display: 'flex', flexDirection: 'column', gap: '4px' 
				}}>
					{/* Running Indicator (Topmost) */}
					{isRunning && (
						<div style={{ 
							width: '6px', height: '6px', borderRadius: '50%', 
							background: 'var(--halo-accent)', 
							boxShadow: '0 0 5px var(--halo-accent)',
							animation: 'pulse 2s infinite'
						}} />
					)}
					
					{/* Environmental Indicator (Below Running) */}
					{engineEnabled && (
						<div style={{ 
							width: '6px', height: '6px', borderRadius: '50%', 
							background: '#10b981',
							boxShadow: '0 0 5px #10b981'
						}} />
					)}
				</div>

				{/* Bottom Category Accent Line */}
				<div style={{ 
					position: 'absolute', bottom: '6px', left: '25%', right: '25%', 
					height: '2.5px', borderRadius: '2px',
					background: mainThemeColor,
					opacity: isHovered || isPinned ? 0.9 : 0.3,
					transition: 'opacity 0.2s',
					boxShadow: isPinned || isHovered ? `0 0 6px ${mainThemeColor}66` : 'none'
				}} />

				<span style={{ 
					...commonStyles.toolIcon as React.CSSProperties, 
					fontSize: settings?.iconSize === 'large' ? (isCompact ? '28px' : '32px') : 
							  settings?.iconSize === 'small' ? (isCompact ? '16px' : '18px') : 
							  (isCompact ? '20px' : '24px'),
					marginBottom: isCompact ? '2px' : '4px',
					transition: 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
					transform: isHovered ? 'scale(1.15)' : 'scale(1)'
				}}>{tool.icon}</span>
				{showLabels && <span style={{ 
					...commonStyles.toolLabel as React.CSSProperties, 
					fontSize: isCompact ? '10px' : '11px',
					color: isPinned ? 'var(--halo-text)' : 'var(--halo-text-muted)',
					fontWeight: isPinned ? 600 : 400
				}}>{t(`tools.${tool.id}.name`)}</span>}
				
				{/* Professional Pin Overlay */}
				{(isPinned || (isHovered && isReady)) && (
					<div 
						onClick={(e) => {
							e.stopPropagation();
							onTogglePin(tool.id);
						}}
						onMouseEnter={() => setIsPinHovered(true)}
						onMouseLeave={() => setIsPinHovered(false)}
						style={{ 
							position: 'absolute', 
							top: isCompact ? '-6px' : '-8px', 
							right: isCompact ? '-6px' : '-8px',
							width: isCompact ? '20px' : '24px',
							height: isCompact ? '20px' : '24px',
							borderRadius: '50%',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							zIndex: 2,
							cursor: 'pointer',
							transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
							background: isPinned ? '#fb7185' : 'rgba(255, 255, 255, 0.95)',
							boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
							border: '1px solid var(--halo-border)',
							transform: isPinHovered ? 'scale(1.1) translateY(-1px)' : 'scale(1)',
						}}
					>
						<span style={{ 
							fontSize: isCompact ? '12px' : '14px',
							opacity: isPinned ? 1 : (isPinHovered ? 1 : 0.8),
							// HCI Logic Refinement for Windows Emoji:
							// Standard 📌 is slanted ~45deg. 
							// To make it vertical (needle down), rotate -45deg.
							// To make it slanted (normal), use 0deg.
							transform: (isPinned || isPinHovered) ? 'rotate(0deg)' : 'rotate(-45deg)',
							transition: 'transform 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
							display: 'inline-block'
						}}>📌</span>
					</div>
				)}
			</button>
			
			<style dangerouslySetInnerHTML={{ __html: `
				@keyframes pulse {
					0% { transform: scale(0.85); opacity: 0.5; }
					50% { transform: scale(1.15); opacity: 1; }
					100% { transform: scale(0.85); opacity: 0.5; }
				}
			`}} />
		</div>
	);
};
