// goal: IP Lookup panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	row: { display: 'flex', gap: '8px' },
	input: {
		flex: 1, padding: '12px 16px', borderRadius: '8px', fontSize: '14px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', fontFamily: 'monospace',
	},
	btn: {
		padding: '12px 20px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none',
	},
	card: {
		padding: '16px', background: 'var(--halo-bg-secondary)', borderRadius: '12px',
		border: '1px solid var(--halo-border)',
	},
	ip: { fontSize: '28px', fontWeight: 700, fontFamily: 'monospace', color: 'var(--halo-text)', marginBottom: '12px' },
	grid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' },
	item: { display: 'flex', flexDirection: 'column', gap: '2px' },
	label: { fontSize: '10px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase' },
	value: { fontSize: '13px', color: 'var(--halo-text)' },
	empty: { padding: '32px', textAlign: 'center', color: 'var(--halo-text-muted)' },
	loading: { padding: '24px', textAlign: 'center', color: 'var(--halo-text-muted)' },
};
