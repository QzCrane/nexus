// goal: Session Manager panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' },
	controls: { display: 'flex', gap: '8px' },
	input: {
		flex: 1, padding: '10px', borderRadius: '6px', fontSize: '13px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', color: 'var(--halo-text)',
	},
	btn: {
		padding: '10px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', gap: '6px'
	},
	list: {
		flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '8px',
	},
	card: {
		padding: '12px', borderRadius: '8px', background: 'var(--halo-bg-secondary)', border: '1px solid var(--halo-border)',
	},
	header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' },
	title: { fontWeight: 600, fontSize: '13px', color: 'var(--halo-text)' },
	meta: { fontSize: '11px', color: 'var(--halo-text-muted)' },
	actions: { display: 'flex', gap: '8px', marginTop: '8px' },
	actionBtn: {
		padding: '6px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)', border: '1px solid var(--halo-border)',
	},
	primaryBtn: {
		padding: '6px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none',
	},
	deleteBtn: {
		padding: '6px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
		background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)',
		marginLeft: 'auto'
	},
	tabList: {
		display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '100px', overflowY: 'auto',
		background: 'var(--halo-bg-tertiary)', padding: '6px', borderRadius: '4px'
	},
	tabItem: {
		fontSize: '11px', color: 'var(--halo-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
	}
};
