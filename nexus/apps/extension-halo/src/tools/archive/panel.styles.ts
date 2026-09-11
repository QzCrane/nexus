// goal: Archive panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	row: { display: 'flex', gap: '8px', alignItems: 'center' },
	btn: {
		padding: '10px 20px', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none', transition: 'var(--halo-motion-transition, opacity 0.15s)',
		display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center',
	},
	btnSecondary: {
		padding: '6px 12px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer',
		background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)', border: '1px solid var(--halo-border)',
	},
	btnDanger: {
		padding: '4px 8px', borderRadius: '4px', fontSize: '10px', cursor: 'pointer',
		background: 'transparent', color: 'var(--halo-error, #ef4444)', border: 'none',
	},
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase' as const },
	entryCard: {
		display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px',
		background: 'var(--halo-bg-secondary)', borderRadius: '8px', border: '1px solid var(--halo-border)',
	},
	entryTitle: { fontSize: '13px', fontWeight: 600, color: 'var(--halo-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
	entryMeta: { fontSize: '10px', color: 'var(--halo-text-muted)' },
	entryActions: { display: 'flex', gap: '6px', marginTop: '4px' },
	emptyState: { textAlign: 'center', padding: '40px 20px', color: 'var(--halo-text-muted)', fontSize: '13px' },
};
