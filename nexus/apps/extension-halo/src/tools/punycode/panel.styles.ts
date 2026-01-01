// goal: Punycode panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	textarea: {
		width: '100%', minHeight: '80px', padding: '12px', borderRadius: '8px', fontSize: '13px',
		fontFamily: 'monospace', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', resize: 'vertical',
	},
	row: { display: 'flex', gap: '8px' },
	btn: {
		flex: 1, padding: '12px', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none',
	},
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', marginBottom: '4px' },
};
