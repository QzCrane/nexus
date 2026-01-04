// goal: Styles for code-snippets panel
// note: Modals should use unified OverlayProvider, not inline styles

import type { CSSProperties } from 'react';

export const styles: Record<string, CSSProperties> = {
	wrapper: {
		display: 'flex',
		flexDirection: 'column',
		gap: '12px',
		padding: '12px',
		height: '100%',
		overflow: 'auto',
	},
	header: {
		display: 'flex',
		alignItems: 'center',
		gap: '8px',
	},
	// Note: Use unified SearchInput from components/ui for search boxes
	btn: {
		padding: '8px 14px',
		borderRadius: '6px',
		border: 'none',
		background: 'var(--halo-accent)',
		color: 'white',
		cursor: 'pointer',
		fontWeight: 500,
		whiteSpace: 'nowrap',
	},
	btnSecondary: {
		padding: '6px 10px',
		borderRadius: '4px',
		border: '1px solid var(--halo-border)',
		background: 'transparent',
		color: 'var(--halo-text)',
		cursor: 'pointer',
		fontSize: '12px',
	},
	filterRow: {
		display: 'flex',
		gap: '8px',
		flexWrap: 'wrap',
	},
	select: {
		padding: '6px 10px',
		borderRadius: '4px',
		border: '1px solid var(--halo-border)',
		background: 'var(--halo-input-bg)',
		color: 'var(--halo-text)',
		fontSize: '12px',
	},
	list: {
		display: 'flex',
		flexDirection: 'column',
		gap: '8px',
	},
	card: {
		padding: '12px',
		borderRadius: '8px',
		border: '1px solid var(--halo-border)',
		background: 'var(--halo-card-bg)',
	},
	cardHeader: {
		display: 'flex',
		justifyContent: 'space-between',
		alignItems: 'center',
		marginBottom: '8px',
	},
	title: {
		fontWeight: 600,
		fontSize: '14px',
	},
	meta: {
		display: 'flex',
		gap: '6px',
		alignItems: 'center',
	},
	badge: {
		padding: '2px 6px',
		borderRadius: '4px',
		fontSize: '10px',
		fontWeight: 600,
		background: 'var(--halo-accent)',
		color: 'white',
	},
	tag: {
		padding: '2px 6px',
		borderRadius: '4px',
		fontSize: '10px',
		background: 'rgba(100,100,100,0.2)',
	},
	codeBlock: {
		padding: '10px',
		borderRadius: '6px',
		background: '#1a1a1a',
		fontFamily: 'monospace',
		fontSize: '12px',
		overflowX: 'auto',
		maxHeight: '120px',
		whiteSpace: 'pre',
		color: '#e0e0e0',
	},
	actions: {
		display: 'flex',
		gap: '6px',
		marginTop: '8px',
	},
	input: {
		padding: '10px 12px',
		borderRadius: '6px',
		border: '1px solid var(--halo-border)',
		background: 'var(--halo-input-bg)',
		color: 'var(--halo-text)',
		fontSize: '13px',
	},
	textarea: {
		padding: '10px 12px',
		borderRadius: '6px',
		border: '1px solid var(--halo-border)',
		background: 'var(--halo-input-bg)',
		color: 'var(--halo-text)',
		fontFamily: 'monospace',
		fontSize: '12px',
		resize: 'vertical',
		minHeight: '150px',
	},
	empty: {
		textAlign: 'center',
		padding: '40px 20px',
		color: 'var(--halo-text-secondary)',
	},
};
