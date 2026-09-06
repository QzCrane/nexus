// goal: SearchBar component styles
// eff: Styles for search input, dropdown, and results

import type React from 'react';

export const searchBarStyles: Record<string, React.CSSProperties> = {
	wrapper: {
		position: 'relative',
		width: '100%',
	},
	inputWrapper: {
		display: 'flex',
		alignItems: 'center',
		gap: '8px',
		padding: '8px 12px',
		background: 'var(--halo-bg-secondary)',
		border: '1px solid var(--halo-border)',
		borderRadius: '8px',
		transition: 'var(--halo-motion-transition, border-color 0.15s, box-shadow 0.15s)',
	},
	inputWrapperFocus: {
		borderColor: 'var(--halo-accent)',
		boxShadow: '0 0 0 2px var(--halo-accent-alpha, rgba(124, 58, 237, 0.2))',
	},
	icon: {
		fontSize: '14px',
		opacity: 0.6,
	},
	input: {
		flex: 1,
		border: 'none',
		background: 'transparent',
		color: 'var(--halo-text)',
		fontSize: '13px',
		outline: 'none',
	},
	shortcut: {
		fontSize: '10px',
		padding: '2px 6px',
		background: 'var(--halo-bg-tertiary)',
		borderRadius: '4px',
		color: 'var(--halo-text-muted)',
	},
	dropdown: {
		position: 'absolute',
		top: 'calc(100% + 4px)',
		left: 0,
		right: 0,
		background: 'var(--halo-bg-secondary)',
		border: '1px solid var(--halo-border)',
		borderRadius: '8px',
		maxHeight: '300px',
		overflowY: 'auto',
		zIndex: 100,
		boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
	},
	item: {
		display: 'flex',
		alignItems: 'center',
		gap: '10px',
		padding: '10px 12px',
		cursor: 'pointer',
		transition: 'var(--halo-motion-transition, background 0.1s)',
	},
	itemActive: {
		background: 'var(--halo-bg-tertiary)',
	},
	itemIcon: {
		fontSize: '16px',
		width: '24px',
		textAlign: 'center',
	},
	itemInfo: {
		flex: 1,
		minWidth: 0,
	},
	itemName: {
		fontSize: '13px',
		color: 'var(--halo-text)',
		fontWeight: 500,
	},
	itemDesc: {
		fontSize: '11px',
		color: 'var(--halo-text-muted)',
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
	},
	itemStatus: {
		fontSize: '10px',
		padding: '2px 6px',
		borderRadius: '4px',
	},
	noResults: {
		padding: '16px',
		textAlign: 'center',
		color: 'var(--halo-text-muted)',
		fontSize: '13px',
	},
};
