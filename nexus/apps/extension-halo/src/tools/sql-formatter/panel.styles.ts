// goal: SQL Formatter panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	textarea: {
		width: '100%', minHeight: '150px', padding: '12px', borderRadius: '8px', fontSize: '12px',
		fontFamily: 'monospace', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', resize: 'vertical',
	},
	row: { display: 'flex', gap: '8px' },
	btn: {
		flex: 1, padding: '12px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none',
	},
	btnSecondary: {
		flex: 1, padding: '12px', borderRadius: '8px', fontSize: '13px', cursor: 'pointer',
		background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)', border: '1px solid var(--halo-border)',
	},
	status: { fontSize: '12px', padding: '8px 12px', borderRadius: '6px' },
	valid: { background: 'rgba(34, 197, 94, 0.1)', color: '#22c55e' },
	invalid: { background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' },
};
