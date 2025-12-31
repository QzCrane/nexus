// goal: Storage Editor panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	row: { display: 'flex', gap: '8px', alignItems: 'center' },
	btn: {
		padding: '10px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none',
	},
	btnSecondary: {
		padding: '8px 12px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer',
		background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)', border: '1px solid var(--halo-border)',
	},
	filter: { display: 'flex', gap: '8px' },
	filterBtn: { padding: '6px 12px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', border: 'none' },
	list: { display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '350px', overflowY: 'auto' },
	item: { padding: '10px', background: 'var(--halo-bg-secondary)', borderRadius: '8px' },
	itemHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' },
	key: { fontSize: '12px', fontWeight: 600, fontFamily: 'monospace', color: 'var(--halo-text)' },
	type: { padding: '2px 6px', borderRadius: '3px', fontSize: '9px', fontWeight: 600, color: '#fff' },
	value: {
		width: '100%', minHeight: '60px', padding: '8px', borderRadius: '4px', fontSize: '11px',
		fontFamily: 'monospace', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', resize: 'vertical',
	},
	meta: { display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '10px', color: 'var(--halo-text-muted)' },
	empty: { padding: '32px', textAlign: 'center', color: 'var(--halo-text-muted)' },
};
