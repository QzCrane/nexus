// goal: HTML Entity panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	tabs: { display: 'flex', gap: '4px' },
	tab: {
		flex: 1, padding: '10px', textAlign: 'center', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
		cursor: 'pointer', border: 'none', transition: 'all 0.15s',
	},
	active: { background: 'var(--halo-accent)', color: '#fff' },
	inactive: { background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-muted)' },
	textarea: {
		width: '100%', minHeight: '120px', padding: '12px', resize: 'vertical',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		borderRadius: '8px', color: 'var(--halo-text)', fontSize: '12px', fontFamily: 'monospace',
	},
	row: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
	btn: {
		padding: '10px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none',
	},
	btnSecondary: {
		padding: '8px 12px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer',
		background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)', border: '1px solid var(--halo-border)',
	},
	label: { fontSize: '10px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase' as const },
	table: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', maxHeight: '200px', overflowY: 'auto' },
	tableItem: { padding: '6px', background: 'var(--halo-bg-secondary)', borderRadius: '4px', fontSize: '11px', textAlign: 'center' },
};
