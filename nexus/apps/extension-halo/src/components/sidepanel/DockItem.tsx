// goal: Individual dock item component for DockTabBar
// eff: Handles single icon rendering, hover, close button

import type React from 'react';
import type { ToolMeta } from '../../kernel';
import { StatusIndicators } from './LauncherToolItemParts';

interface DockItemProps {
	tool: ToolMeta;
	label: string;
	closeLabel: string;
	isActive: boolean;
	scale: number;
	baseSize: number;
	onMouseEnter: (e: React.MouseEvent) => void;
	onMouseLeave: () => void;
	onClick: () => void;
	onClose: () => void;
	serviceState?: 'active' | 'inactive';
}

// Styles extracted to reduce component line count
const getIconStyle = (isActive: boolean) => ({
	width: '100%',
	height: '100%',
	borderRadius: '10px',
	background: isActive ? 'linear-gradient(145deg, #8b5cf6, #6d28d9)' : 'var(--halo-bg-tertiary)',
	display: 'flex' as const,
	alignItems: 'center' as const,
	justifyContent: 'center' as const,
	fontSize: '20px',
	boxShadow: isActive ? '0 3px 12px rgba(124,58,237,0.5)' : '0 1px 4px rgba(0,0,0,0.2)',
	border: isActive ? 'none' : '1px solid var(--halo-border)',
});

const closeButtonStyle: React.CSSProperties = {
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
};

export const DockItem: React.FC<DockItemProps> = ({
	tool, label, closeLabel, isActive, scale, baseSize,
	onMouseEnter, onMouseLeave, onClick, onClose, serviceState
}) => (
	// biome-ignore lint/a11y/noStaticElementInteractions: This neutral wrapper only tracks pointer hover for dock magnification; activation belongs to the sibling native buttons.
	<div
		data-dock-item
		onMouseEnter={onMouseEnter}
		onMouseLeave={onMouseLeave}
		style={{
			position: 'relative',
			flexShrink: 0,
			width: `${baseSize}px`,
			height: `${baseSize}px`,
			pointerEvents: 'auto',
		}}
	>
		{/* Visual icon: transforms independently */}
		<div style={{
			position: 'absolute',
			left: 0,
			bottom: 0,
			width: `${baseSize}px`,
			height: `${baseSize}px`,
			transition: 'transform 0.12s cubic-bezier(0.34, 1.56, 0.64, 1)',
			transform: `scale(${scale})`,
			transformOrigin: 'center bottom',
		}}>
			<button
				type="button"
				aria-label={label}
				onClick={onClick}
				style={{
					...getIconStyle(isActive),
					padding: 0,
					color: 'inherit',
					cursor: 'pointer',
				}}
			>
				<span aria-hidden="true">{tool.icon}</span>
				{/* Indicators overlay - positioned relative to icon */}
				<StatusIndicators isRunning={false} engineEnabled={false} serviceState={serviceState} />
			</button>
			<button
				type="button"
				className="halo-dock-close-button"
				aria-label={`${closeLabel}: ${label}`}
				onClick={onClose}
				style={closeButtonStyle}
			>
				<span aria-hidden="true">×</span>
			</button>
		</div>
	</div>
);
