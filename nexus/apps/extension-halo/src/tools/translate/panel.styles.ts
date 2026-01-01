// goal: Translate panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '16px', padding: '12px' },
	section: { display: 'flex', flexDirection: 'column', gap: '8px' },
	label: { fontSize: '12px', fontWeight: 600, color: 'var(--halo-text-muted)' },
	btnGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' },
	btn: {
		padding: '12px', borderRadius: '8px', border: '1px solid var(--halo-border)',
		background: 'var(--halo-bg-secondary)', color: 'var(--halo-text)', cursor: 'pointer',
		display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: 500
	},
	primary: {
		background: 'var(--halo-accent)', color: '#fff', border: 'none'
	},
	textarea: {
		width: '100%', minHeight: '80px', padding: '10px', borderRadius: '8px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', fontSize: '13px', resize: 'vertical'
	}
};
