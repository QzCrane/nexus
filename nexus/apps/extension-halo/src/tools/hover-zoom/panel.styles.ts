// goal: Hover zoom panel styles
// eff: Settings panel layout

import type { CSSProperties } from 'react';

export const styles: Record<string, CSSProperties> = {
	container: {
		display: 'flex',
		flexDirection: 'column',
		gap: '16px',
		padding: '16px',
		height: '100%',
		overflow: 'auto',
	},
	section: {
		display: 'flex',
		flexDirection: 'column',
		gap: '12px',
		padding: '12px',
		borderRadius: '10px',
		background: 'var(--halo-bg-secondary)',
		border: '1px solid var(--halo-border)',
	},
	sectionTitle: {
		fontSize: '13px',
		fontWeight: 600,
		color: 'var(--halo-text)',
		marginBottom: '4px',
	},
	row: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: '12px',
	},
	label: {
		fontSize: '13px',
		color: 'var(--halo-text)',
	},
	description: {
		fontSize: '11px',
		color: 'var(--halo-text-muted)',
		marginTop: '-4px',
	},
	segmented: {
		display: 'flex',
		gap: '4px',
		background: 'var(--halo-bg-tertiary)',
		padding: '3px',
		borderRadius: '6px',
	},
	segmentBtn: {
		padding: '4px 10px',
		borderRadius: '4px',
		border: 'none',
		background: 'transparent',
		color: 'var(--halo-text-muted)',
		fontSize: '12px',
		cursor: 'pointer',
		transition: 'all 0.15s',
	},
	segmentBtnActive: {
		background: 'var(--halo-accent)',
		color: '#fff',
	},
	slider: {
		flex: 1,
		accentColor: 'var(--halo-accent)',
	},
	value: {
		fontSize: '12px',
		color: 'var(--halo-text-muted)',
		minWidth: '50px',
		textAlign: 'right',
	},
	domainList: {
		display: 'flex',
		flexWrap: 'wrap',
		gap: '4px',
		marginTop: '8px',
	},
	domainTag: {
		padding: '2px 8px',
		borderRadius: '4px',
		background: 'var(--halo-bg-tertiary)',
		fontSize: '11px',
		color: 'var(--halo-text-muted)',
	},
};
