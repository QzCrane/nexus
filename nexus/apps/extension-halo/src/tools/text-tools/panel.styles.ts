// goal: Text Tools panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	tabs: { display: 'flex', gap: '4px', flexWrap: 'wrap' },
	tab: {
		padding: '6px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
		border: 'none', transition: 'all 0.15s',
	},
	active: { background: 'var(--halo-accent)', color: '#fff' },
	inactive: { background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-muted)' },
	textarea: {
		width: '100%', minHeight: '150px', padding: '12px', resize: 'vertical',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		borderRadius: '8px', color: 'var(--halo-text)', fontSize: '12px', fontFamily: 'monospace',
	},
	row: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
	btn: {
		padding: '8px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none', transition: 'opacity 0.15s',
	},
	btnSecondary: {
		padding: '6px 12px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer',
		background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)', border: '1px solid var(--halo-border)',
	},
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase' as const },
	stat: { display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--halo-bg-secondary)', borderRadius: '6px' },
	statLabel: { fontSize: '11px', color: 'var(--halo-text-muted)' },
	statValue: { fontSize: '13px', fontWeight: 600, color: 'var(--halo-text)' },
	select: {
		padding: '8px 12px', borderRadius: '6px', fontSize: '12px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', cursor: 'pointer',
	},
};
