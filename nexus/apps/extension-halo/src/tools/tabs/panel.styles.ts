// goal: Styles for TabsPanel
// eff: Extracted to separate file

import React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	container: {
		display: 'flex',
		flexDirection: 'column',
		gap: '12px',
		height: '100%',
		minHeight: '400px',
	},
	filterBar: {
		display: 'flex',
		gap: '8px',
		overflowX: 'auto',
		paddingBottom: '4px',
	},
	filterChip: {
		padding: '4px 8px',
		borderRadius: '12px',
		fontSize: '11px',
		cursor: 'pointer',
		border: '1px solid var(--halo-border, #444)',
		background: 'transparent',
		color: 'var(--halo-text-muted, #888)',
		transition: 'all 0.2s',
		whiteSpace: 'nowrap',
	},
	filterChipActive: {
		background: 'var(--halo-accent, #7c3aed)',
		borderColor: 'var(--halo-accent, #7c3aed)',
		color: '#fff',
	},
	searchInput: {
		width: '100%',
		padding: '8px 12px',
		borderRadius: '8px',
		border: '1px solid var(--halo-border, #444)',
		background: 'var(--halo-bg-secondary, #252525)',
		color: 'var(--halo-text, #fff)',
		fontSize: '13px',
		outline: 'none',
	},
	list: {
		display: 'flex',
		flexDirection: 'column',
		gap: '4px',
		overflowY: 'auto',
		flex: 1,
		maxHeight: 'calc(100vh - 120px)', // Approx adjustment
	},
	tabItem: {
		display: 'flex',
		alignItems: 'center',
		gap: '10px',
		padding: '8px 10px',
		borderRadius: '8px',
		cursor: 'pointer',
		transition: 'background 0.2s',
		border: '1px solid transparent',
		position: 'relative',
	},
	tabItemActive: {
		background: 'var(--halo-bg-secondary, #252525)',
		borderColor: 'var(--halo-accent, #7c3aed)',
	},
	favicon: {
		width: '16px',
		height: '16px',
		borderRadius: '2px',
	},
	tabInfo: {
		flex: 1,
		overflow: 'hidden',
		display: 'flex',
		flexDirection: 'column',
		gap: '2px',
	},
	tabTitle: {
		fontSize: '13px',
		color: 'var(--halo-text, #fff)',
		whiteSpace: 'nowrap',
		overflow: 'hidden',
		textOverflow: 'ellipsis',
	},
	tabUrl: {
		fontSize: '11px',
		color: 'var(--halo-text-muted, #666)',
		whiteSpace: 'nowrap',
		overflow: 'hidden',
		textOverflow: 'ellipsis',
	},
	indicators: {
		display: 'flex',
		gap: '4px',
		alignItems: 'center',
	},
	indicator: {
		fontSize: '12px',
	},
	closeBtn: {
		opacity: 0.6,
		padding: '4px',
		borderRadius: '4px',
		cursor: 'pointer',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		fontSize: '14px',
		transition: 'all 0.2s',
		color: 'var(--halo-text-muted, #888)',
	},
	empty: {
		textAlign: 'center',
		padding: '40px',
		color: 'var(--halo-text-muted, #666)',
		fontSize: '13px',
	},
};
