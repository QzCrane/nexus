// goal: Font Inspector panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	btn: {
		width: '100%', padding: '14px', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none',
	},
	list: { display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '400px', overflowY: 'auto' },
	family: {
		padding: '16px', background: 'var(--halo-bg-secondary)', borderRadius: '12px',
		border: '1px solid var(--halo-border)',
	},
	familyName: { fontSize: '20px', fontWeight: 700, color: 'var(--halo-text)', marginBottom: '8px' },
	sample: { fontSize: '14px', color: 'var(--halo-text-muted)', marginBottom: '12px' },
	variants: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
	variant: {
		padding: '4px 8px', borderRadius: '4px', fontSize: '10px',
		background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-muted)',
	},
	actions: { display: 'flex', gap: '8px', marginTop: '8px' },
	actionBtn: {
		padding: '6px 12px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer',
		background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)', border: 'none',
	},
	empty: { padding: '32px', textAlign: 'center', color: 'var(--halo-text-muted)' },
};
