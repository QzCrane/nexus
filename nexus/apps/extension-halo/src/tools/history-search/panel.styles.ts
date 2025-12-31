// goal: History Search panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	search: {
		width: '100%', padding: '12px 16px', borderRadius: '8px', fontSize: '14px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)',
	},
	list: { display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '400px', overflowY: 'auto' },
	item: {
		display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px',
		background: 'var(--halo-bg-secondary)', borderRadius: '8px', cursor: 'pointer',
	},
	favicon: { width: '20px', height: '20px', borderRadius: '4px', flexShrink: 0 },
	info: { flex: 1, minWidth: 0, overflow: 'hidden' },
	title: {
		fontSize: '13px', fontWeight: 500, color: 'var(--halo-text)',
		whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
	},
	url: {
		fontSize: '11px', color: 'var(--halo-text-muted)',
		whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
	},
	meta: { display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 },
	time: { fontSize: '10px', color: 'var(--halo-text-muted)' },
	visits: { fontSize: '10px', color: 'var(--halo-accent)', fontWeight: 600 },
	btn: {
		padding: '4px 8px', borderRadius: '4px', fontSize: '10px', cursor: 'pointer',
		background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-muted)', border: 'none',
	},
	empty: { padding: '32px', textAlign: 'center', color: 'var(--halo-text-muted)', fontSize: '13px' },
};
