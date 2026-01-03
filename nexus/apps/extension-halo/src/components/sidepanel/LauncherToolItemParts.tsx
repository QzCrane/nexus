import React from 'react';

/** Constant category color map for premium aesthetics */
export const CATEGORY_COLORS: Record<string, string> = {
	dev: '#3b82f6',
	efficiency: '#8b5cf6',
	visual: '#ec4899',
	security: '#ef4444',
	browser: '#f59e0b',
	ai: '#10b981',
	media: '#06b6d4',
	general: '#6366f1',
	scripts: '#f97316', // Orange for scripts
};

export const getCategoryColor = (category: string) => CATEGORY_COLORS[category] || 'var(--halo-accent)';

/** Indicator dots for running and engine status */
export const StatusIndicators: React.FC<{ isRunning: boolean; engineEnabled: boolean; serviceState?: 'active' | 'inactive' }> = ({ 
	isRunning, 
	engineEnabled,
	serviceState
}) => (
	<div style={{ position: 'absolute', top: '5px', left: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
		{/* Open in Panel Indicator */}
		{isRunning && (
			<div style={{ 
				width: '6px', height: '6px', borderRadius: '50%', 
				background: 'var(--halo-accent)', boxShadow: '0 0 5px var(--halo-accent)',
			}} />
		)}
		
		{/* Engine Status Indicator (Only if explicit serviceState is missing) */}
		{engineEnabled && !serviceState && (
			<div style={{ 
				width: '6px', height: '6px', borderRadius: '50%', 
				background: '#10b981', boxShadow: '0 0 5px #10b981'
			}} />
		)}

		{/* Background Service Indicator (Green/Grey) */}
		{serviceState && (
			<div style={{ 
				width: '6px', height: '6px', borderRadius: '50%', 
				background: serviceState === 'active' ? '#4CAF50' : 'var(--halo-text-muted)',
				boxShadow: serviceState === 'active' ? '0 0 5px #4CAF50' : 'none',
				opacity: serviceState === 'active' ? 1 : 0.5,
				animation: serviceState === 'active' ? 'halo-pulse 2s infinite' : 'none',
				transition: 'all 0.3s ease'
			}} />
		)}
	</div>
);

/** The "Pinned" pin overlay */
export const PinOverlay: React.FC<{ 
	isPinned: boolean; 
	isPinHovered: boolean; 
	isCompact: boolean; 
	onToggle: (e: React.MouseEvent) => void;
	onMouseEnter: () => void;
	onMouseLeave: () => void;
}> = ({ isPinned, isPinHovered, isCompact, onToggle, onMouseEnter, onMouseLeave }) => (
	<div 
		onClick={onToggle}
		onMouseEnter={onMouseEnter}
		onMouseLeave={onMouseLeave}
		style={{ 
			position: 'absolute', 
			top: isCompact ? '-6px' : '-8px', 
			right: isCompact ? '-6px' : '-8px',
			width: isCompact ? '20px' : '24px',
			height: isCompact ? '20px' : '24px',
			borderRadius: '50%',
			display: 'flex', alignItems: 'center', justifyContent: 'center',
			zIndex: 2, cursor: 'pointer',
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
			transform: (isPinned || isPinHovered) ? 'rotate(0deg)' : 'rotate(-45deg)',
			transition: 'transform 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
			display: 'inline-block'
		}}>📌</span>
	</div>
);

/** Shared animations for the tool items */
export const ToolAnimations = () => (
	<style dangerouslySetInnerHTML={{ __html: `
		@keyframes halo-pulse {
			0% { transform: scale(0.85); opacity: 0.5; }
			50% { transform: scale(1.15); opacity: 1; }
			100% { transform: scale(0.85); opacity: 0.5; }
		}
	`}} />
);
