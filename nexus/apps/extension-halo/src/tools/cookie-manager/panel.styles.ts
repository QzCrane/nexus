// goal: Cookie Manager panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
	title: { fontSize: '14px', fontWeight: 600, color: 'var(--halo-text)' },
	count: { fontSize: '12px', color: 'var(--halo-text-muted)' },
	row: { display: 'flex', gap: '8px', alignItems: 'center' },
	search: {
		flex: 1, padding: '8px 12px', borderRadius: '6px', fontSize: '12px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)',
	},
	list: { display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '350px', overflowY: 'auto' },
	item: {
		padding: '10px 12px', background: 'var(--halo-bg-secondary)',
		borderRadius: '8px', border: '1px solid var(--halo-border)',
	},
	itemHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
	name: { fontSize: '13px', fontWeight: 600, color: 'var(--halo-text)', fontFamily: 'monospace' },
	value: {
		fontSize: '11px', color: 'var(--halo-text-muted)', fontFamily: 'monospace',
		marginTop: '4px', wordBreak: 'break-all', maxHeight: '40px', overflow: 'hidden',
	},
	meta: { display: 'flex', gap: '8px', marginTop: '6px', fontSize: '10px', color: 'var(--halo-text-muted)' },
	badge: { padding: '2px 6px', borderRadius: '4px', fontSize: '9px', fontWeight: 600, background: 'var(--halo-bg-tertiary)' },
	btn: {
		padding: '4px 8px', borderRadius: '4px', fontSize: '10px', cursor: 'pointer',
		background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-muted)', border: '1px solid var(--halo-border)',
	},
	btnDanger: { background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderColor: '#ef4444' },
	empty: { padding: '32px', textAlign: 'center', color: 'var(--halo-text-muted)', fontSize: '13px' },
};
