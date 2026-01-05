// goal: Premium styles for ToolManager component
// eff: Implements glassmorphism, smooth transitions, and vibrancy

import React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: {
		display: 'flex',
		flexDirection: 'column',
		gap: '16px',
		padding: '4px', // Slight padding to prevent clipping of shadows
	},
	header: {
		display: 'flex',
		justifyContent: 'space-between',
		alignItems: 'center',
		marginBottom: '4px',
	},
	title: {
		fontSize: '16px',
		fontWeight: 700,
		background: 'linear-gradient(90deg, var(--halo-text) 0%, var(--halo-text-secondary) 100%)',
		WebkitBackgroundClip: 'text',
		WebkitTextFillColor: 'transparent',
		letterSpacing: '-0.3px',
	},
	actions: {
		display: 'flex',
		gap: '8px',
	},
	btn: {
		padding: '6px 12px',
		fontSize: '11px',
		fontWeight: 600,
		background: 'var(--halo-bg-tertiary)',
		border: '1px solid var(--halo-border)',
		borderRadius: '8px',
		color: 'var(--halo-text-secondary)',
		cursor: 'pointer',
		transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
	},

	// Search Bar with Glassmorphism
	searchWrapper: {
		position: 'relative',
		display: 'flex',
		alignItems: 'center',
	},
	searchIcon: {
		position: 'absolute',
		left: '12px',
		fontSize: '14px',
		opacity: 0.5,
		pointerEvents: 'none',
	},
	searchInput: {
		width: '100%',
		padding: '10px 12px 10px 36px',
		background: 'var(--halo-bg-secondary)', // Fallback
		backdropFilter: 'blur(12px)',
		border: '1px solid var(--halo-border)',
		borderRadius: '12px',
		color: 'var(--halo-text)',
		fontSize: '13px',
		outline: 'none',
		transition: 'border-color 0.2s, box-shadow 0.2s',
		boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
	},

	// Category Filters
	filters: {
		display: 'flex',
		gap: '8px',
		overflowX: 'auto',
		paddingBottom: '4px',
		scrollbarWidth: 'none', // Hide scrollbar
		msOverflowStyle: 'none',
	},
	filterChip: {
		flexShrink: 0,
		padding: '6px 14px',
		fontSize: '12px',
		fontWeight: 500,
		background: 'var(--halo-bg-tertiary)',
		border: '1px solid transparent',
		borderRadius: '20px',
		color: 'var(--halo-text-secondary)',
		cursor: 'pointer',
		display: 'flex',
		alignItems: 'center',
		gap: '6px',
		transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
	},
	filterChipActive: {
		background: 'var(--halo-accent)',
		color: '#fff',
		boxShadow: '0 4px 12px var(--halo-accent-alpha)',
		borderColor: 'rgba(255,255,255,0.1)',
	},

	// List Container
	cardOverride: {
		background: 'var(--halo-bg-glass)',
		backdropFilter: 'blur(20px)',
		border: '1px solid var(--halo-border)',
		borderRadius: '16px',
		overflow: 'hidden',
	},
	list: {
		display: 'flex',
		flexDirection: 'column',
		maxHeight: '450px',
		overflowY: 'auto',
		padding: '4px', // Space for item focus rings
	},
	empty: {
		padding: '32px',
		textAlign: 'center',
		color: 'var(--halo-text-muted)',
		fontSize: '13px',
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		gap: '8px',
	},

	// Item Styles
	item: {
		display: 'flex',
		alignItems: 'center',
		gap: '12px',
		padding: '10px 12px',
		borderRadius: '10px',
		transition: 'background 0.15s, transform 0.1s',
		cursor: 'default',
		border: '1px solid transparent',
	},
	// Pseudo-hover effect is handled by parent or CSS file usually, 
	// but here we rely on standard React render.
	// Ideally, move hover states to CSS modules or use CSS-in-JS libraries that support pseudo-classes.
	// For now, we keep it simple.

	itemIcon: {
		fontSize: '22px',
		width: '36px',
		height: '36px',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		background: 'var(--halo-bg-tertiary)',
		borderRadius: '8px',
	},
	itemInfo: {
		flex: 1,
		minWidth: 0,
	},
	itemName: {
		fontSize: '13px',
		fontWeight: 600,
		color: 'var(--halo-text)',
		display: 'flex',
		alignItems: 'center',
		gap: '6px',
	},
	itemDesc: {
		fontSize: '11px',
		color: 'var(--halo-text-muted)',
		marginTop: '2px',
		whiteSpace: 'nowrap',
		overflow: 'hidden',
		textOverflow: 'ellipsis',
	},
	pinBtn: {
		width: '32px',
		height: '32px',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		background: 'transparent',
		border: 'none',
		borderRadius: '8px',
		cursor: 'pointer',
		fontSize: '16px',
		transition: 'background 0.15s, transform 0.1s',
		color: 'var(--halo-text-muted)',
	},
	badge: {
		fontSize: '9px',
		padding: '2px 6px',
		borderRadius: '4px',
		fontWeight: 600,
	},
};
