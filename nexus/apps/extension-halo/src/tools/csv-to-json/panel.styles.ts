// goal: CSV to JSON panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	textarea: {
		width: '100%', minHeight: '120px', padding: '12px', borderRadius: '8px', fontSize: '11px',
		fontFamily: 'monospace', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', resize: 'vertical',
	},
	row: { display: 'flex', gap: '8px', alignItems: 'center' },
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)' },
	select: {
		padding: '8px 12px', borderRadius: '6px', fontSize: '12px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', color: 'var(--halo-text)',
	},
	checkbox: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer', color: 'var(--halo-text)' },
	btn: {
		flex: 1, padding: '12px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none',
	},
	error: { color: '#ef4444', fontSize: '12px' },
};
