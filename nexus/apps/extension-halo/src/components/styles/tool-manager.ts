// goal: ToolManager component styles
// eff: Styles for tool list, filters, and items

import type React from 'react';

export const toolManagerStyles: Record<string, React.CSSProperties> = {
	wrapper: {
		display: 'flex',
		flexDirection: 'column',
		gap: '12px',
	},
	header: {
		display: 'flex',
		justifyContent: 'space-between',
		alignItems: 'center',
	},
	title: {
		fontSize: '14px',
		fontWeight: 600,
		color: 'var(--halo-text)',
	},
	actions: {
		display: 'flex',
		gap: '8px',
	},
	btn: {
		padding: '6px 10px',
		fontSize: '11px',
		background: 'var(--halo-bg-tertiary)',
		border: '1px solid var(--halo-border)',
		borderRadius: '6px',
		color: 'var(--halo-text-secondary)',
		cursor: 'pointer',
		transition: 'var(--halo-motion-transition, background 0.15s)',
	},
	searchInput: {
		width: '100%',
		padding: '10px 12px',
		background: 'var(--halo-bg-secondary)',
		border: '1px solid var(--halo-border)',
		borderRadius: '8px',
		color: 'var(--halo-text)',
		fontSize: '13px',
		outline: 'none',
	},
	filters: {
		display: 'flex',
		gap: '6px',
		flexWrap: 'wrap',
	},
	filterChip: {
		padding: '6px 12px',
		fontSize: '11px',
		background: 'var(--halo-bg-tertiary)',
		border: '1px solid var(--halo-border)',
		borderRadius: '20px',
		color: 'var(--halo-text-secondary)',
		cursor: 'pointer',
		transition: 'var(--halo-motion-transition, all 0.15s)',
	},
	filterChipActive: {
		background: 'var(--halo-accent)',
		borderColor: 'var(--halo-accent)',
		color: '#fff',
	},
	list: {
		display: 'flex',
		flexDirection: 'column',
		gap: '8px',
		maxHeight: '400px',
		overflowY: 'auto',
	},
	item: {
		display: 'flex',
		alignItems: 'center',
		gap: '12px',
		padding: '12px',
		background: 'var(--halo-bg-secondary)',
		borderRadius: '8px',
		border: '1px solid var(--halo-border)',
	},
	itemIcon: {
		fontSize: '20px',
		width: '32px',
		textAlign: 'center',
	},
	itemInfo: {
		flex: 1,
		minWidth: 0,
	},
	itemName: {
		fontSize: '13px',
		fontWeight: 500,
		color: 'var(--halo-text)',
		display: 'flex',
		alignItems: 'center',
		gap: '6px',
	},
	itemDesc: {
		fontSize: '11px',
		color: 'var(--halo-text-muted)',
		marginTop: '2px',
	},
	pinBtn: {
		width: '28px',
		height: '28px',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		background: 'transparent',
		border: 'none',
		borderRadius: '6px',
		cursor: 'pointer',
		fontSize: '14px',
		transition: 'var(--halo-motion-transition, background 0.15s)',
	},
	badge: {
		fontSize: '9px',
		padding: '2px 6px',
		borderRadius: '4px',
	},
	empty: {
		padding: '24px',
		textAlign: 'center',
		color: 'var(--halo-text-muted)',
		fontSize: '13px',
	},
};
