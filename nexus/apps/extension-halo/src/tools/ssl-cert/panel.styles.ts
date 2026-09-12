// goal: SSL Cert panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	textarea: {
		width: '100%', minHeight: '120px', padding: '12px', borderRadius: '8px', fontSize: '11px',
		fontFamily: 'monospace', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', resize: 'vertical',
	},
	btn: {
		padding: '12px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none',
	},
	result: { padding: '12px', background: 'var(--halo-bg-secondary)', borderRadius: '8px' },
	boundary: {
		padding: '8px 10px', borderRadius: '6px', fontSize: '11px', lineHeight: 1.4,
		background: 'var(--halo-bg-secondary)', color: 'var(--halo-text-muted)',
	},
	row: { display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '12px' },
	label: { fontWeight: 600, color: 'var(--halo-text-muted)' },
	value: { fontFamily: 'monospace' },
};
