// goal: Premium styles for SearchBar component
// eff: Upgraded to match standard Glassmorphism system

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: {
		position: 'relative',
		width: '100%',
	},
	inputWrapper: {
		display: 'flex',
		alignItems: 'center',
		gap: '12px',
		padding: '10px 14px',
		// Glassmorphism upgrade
		background: 'var(--halo-bg-secondary)', // Fallback
		backdropFilter: 'blur(16px)',
		border: '1px solid var(--halo-border)',
		borderRadius: '12px',
		boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
		transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
	},
	inputWrapperFocus: {
		borderColor: 'var(--halo-accent)',
		boxShadow: '0 4px 12px var(--halo-accent-alpha), 0 0 0 1px var(--halo-accent)',
		transform: 'translateY(-1px)',
	},
	icon: {
		fontSize: '15px',
		opacity: 0.5,
		pointerEvents: 'none',
	},
	input: {
		flex: 1,
		border: 'none',
		background: 'transparent',
		color: 'var(--halo-text)',
		fontSize: '13px',
		fontWeight: 500,
		outline: 'none',
		// Consistent text rendering
		letterSpacing: '0.01em',
	},
	// Shortcut badge with pill style
	shortcut: {
		fontSize: '10px',
		padding: '2px 6px',
		background: 'var(--halo-bg-tertiary)',
		borderRadius: '6px',
		color: 'var(--halo-text-muted)',
		border: '1px solid rgba(255,255,255,0.05)',
		fontWeight: 600,
	},

	// Floating result dropdown
	dropdown: {
		position: 'absolute',
		top: 'calc(100% + 6px)',
		left: 0,
		right: 0,
		background: 'var(--halo-bg-glass)',
		backdropFilter: 'blur(20px)',
		border: '1px solid var(--halo-border)',
		borderRadius: '12px',
		maxHeight: '320px',
		overflowY: 'auto',
		zIndex: 1000,
		boxShadow: '0 8px 24px rgba(0,0,0,0.2), 0 2px 8px rgba(0,0,0,0.1)',
		animation: 'haloFadeIn 0.15s cubic-bezier(0.0, 0.0, 0.2, 1)',
		padding: '4px',
	},
	item: {
		display: 'flex',
		alignItems: 'center',
		gap: '12px',
		padding: '10px 12px',
		cursor: 'pointer',
		borderRadius: '8px',
		transition: 'background 0.15s, transform 0.1s',
		margin: '2px 0',
	},
	itemActive: {
		background: 'var(--halo-accent)',
		color: '#fff',
		transform: 'scale(0.99)',
	},
	itemIcon: {
		fontSize: '18px',
		width: '24px',
		textAlign: 'center',
	},
	itemInfo: {
		flex: 1,
		minWidth: 0,
	},
	itemName: {
		fontSize: '13px',
		color: 'inherit', // Dynamic color based on active state
		fontWeight: 500,
	},
	itemDesc: {
		fontSize: '11px',
		color: 'var(--halo-text-muted)',
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
		opacity: 0.8,
	},
	itemStatus: {
		fontSize: '9px',
		padding: '2px 6px',
		borderRadius: '4px',
		fontWeight: 600,
		marginLeft: 'auto',
	},
	noResults: {
		padding: '24px',
		textAlign: 'center',
		color: 'var(--halo-text-muted)',
		fontSize: '13px',
	},
};
