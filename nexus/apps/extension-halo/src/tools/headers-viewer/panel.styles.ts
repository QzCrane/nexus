// goal: Headers Viewer panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	row: { display: 'flex', gap: '8px' },
	input: {
		flex: 1, padding: '10px 14px', borderRadius: '8px', fontSize: '12px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', fontFamily: 'monospace',
	},
	btn: {
		padding: '10px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none',
	},
	list: { display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '350px', overflowY: 'auto' },
	item: {
		display: 'flex', flexDirection: 'column', gap: '2px', padding: '8px 10px',
		background: 'var(--halo-bg-secondary)', borderRadius: '6px',
	},
	name: { fontSize: '11px', fontWeight: 600, fontFamily: 'monospace' },
	value: { fontSize: '11px', color: 'var(--halo-text-muted)', wordBreak: 'break-all' },
	tag: { padding: '2px 6px', borderRadius: '3px', fontSize: '9px', fontWeight: 600, color: '#fff', marginLeft: '6px' },
	empty: { padding: '32px', textAlign: 'center', color: 'var(--halo-text-muted)' },
	loading: { padding: '24px', textAlign: 'center' },
};
