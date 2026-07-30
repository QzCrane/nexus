// goal: Enhanced toolbar with smooth transitions and hover preload
// eff: Animated tool buttons + keyboard shortcuts + preload on hover

import type React from 'react';
import { useCallback, memo } from 'react';
import type { ToolId } from '../../kernel';
import { useToolPreload } from '../core/lazy-tool-loader';

interface ToolButtonProps {
	id: ToolId;
	icon: string;
	label: string;
	isActive: boolean;
	isPinned?: boolean;
	shortcut?: string;
	onClick: (id: ToolId) => void;
}

const ToolButton: React.FC<ToolButtonProps> = memo(({ id, icon, label, isActive, isPinned, shortcut, onClick }) => {
	const { preload, cancelPreload } = useToolPreload();

	const handleMouseEnter = useCallback(() => preload(id), [id, preload]);
	const handleMouseLeave = useCallback(() => cancelPreload(), [cancelPreload]);
	const handleClick = useCallback(() => onClick(id), [id, onClick]);

	const style: React.CSSProperties = {
		display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
		padding: '8px 6px', borderRadius: '10px', cursor: 'pointer',
		background: isActive ? 'var(--halo-accent)' : 'transparent',
		color: isActive ? '#fff' : 'var(--halo-text-muted)',
		border: 'none', transition: 'all 0.15s ease',
		transform: isActive ? 'scale(1.05)' : 'scale(1)',
		position: 'relative', minWidth: '44px',
	};

	return (
		<button type="button"
			style={style}
			onClick={handleClick}
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}
			title={shortcut ? `${label} (${shortcut})` : label}
		>
			<span style={{ fontSize: '18px' }}>{icon}</span>
			<span style={{ fontSize: '9px', fontWeight: 500 }}>{label}</span>
			{isPinned && (
				<span style={{
					position: 'absolute', top: '2px', right: '2px',
					width: '6px', height: '6px', borderRadius: '50%',
					background: 'var(--halo-accent)',
				}} />
			)}
		</button>
	);
});

ToolButton.displayName = 'ToolButton';

interface EnhancedToolbarProps {
	tools: { id: ToolId; icon: string; label: string; pinned?: boolean }[];
	activeTool: ToolId | null;
	onSelectTool: (id: ToolId) => void;
	onOpenPalette: () => void;
}

const styles: Record<string, React.CSSProperties> = {
	container: {
		display: 'flex', alignItems: 'center', gap: '4px',
		padding: '8px 12px', overflowX: 'auto',
		background: 'var(--halo-bg-secondary)',
		borderBottom: '1px solid var(--halo-border)',
	},
	searchBtn: {
		display: 'flex', alignItems: 'center', gap: '6px',
		padding: '8px 12px', borderRadius: '8px', cursor: 'pointer',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text-muted)', fontSize: '12px',
		marginLeft: 'auto', transition: 'all 0.15s',
	},
	divider: {
		width: '1px', height: '24px', background: 'var(--halo-border)', margin: '0 4px',
	},
};

export const EnhancedToolbar: React.FC<EnhancedToolbarProps> = ({
	tools, activeTool, onSelectTool, onOpenPalette,
}) => {
	// Separate pinned and regular tools
	const pinnedTools = tools.filter((t) => t.pinned);
	const regularTools = tools.filter((t) => !t.pinned);

	return (
		<div style={styles.container}>
			{/* Pinned tools first */}
			{pinnedTools.map((tool) => (
				<ToolButton
					key={tool.id}
					id={tool.id}
					icon={tool.icon}
					label={tool.label}
					isActive={activeTool === tool.id}
					isPinned
					onClick={onSelectTool}
				/>
			))}

			{pinnedTools.length > 0 && regularTools.length > 0 && <div style={styles.divider} />}

			{/* Regular tools */}
			{regularTools.slice(0, 6).map((tool) => (
				<ToolButton
					key={tool.id}
					id={tool.id}
					icon={tool.icon}
					label={tool.label}
					isActive={activeTool === tool.id}
					onClick={onSelectTool}
				/>
			))}

			{/* Search/Palette button */}
			<button type="button" style={styles.searchBtn} onClick={onOpenPalette}>
				🔍 <span style={{ fontSize: '10px', opacity: 0.7 }}>⌘K</span>
			</button>
		</div>
	);
};
