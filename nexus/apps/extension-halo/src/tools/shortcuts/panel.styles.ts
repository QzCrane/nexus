// goal: Shortcuts panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	search: {
		width: '100%', padding: '12px 16px', borderRadius: '8px', fontSize: '14px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)',
	},
	group: { marginBottom: '16px' },
	groupTitle: {
		display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: 600,
		color: 'var(--halo-text)', marginBottom: '8px',
	},
	list: { display: 'flex', flexDirection: 'column', gap: '4px' },
	item: {
		display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px',
		background: 'var(--halo-bg-secondary)', borderRadius: '6px',
	},
	keys: {
		display: 'flex', gap: '4px',
	},
	key: {
		padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', fontFamily: 'monospace',
	},
	desc: { fontSize: '12px', color: 'var(--halo-text-muted)' },
	empty: { padding: '32px', textAlign: 'center', color: 'var(--halo-text-muted)' },
};
