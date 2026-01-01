// goal: SRI panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	textarea: {
		width: '100%', minHeight: '100px', padding: '12px', borderRadius: '8px', fontSize: '12px',
		fontFamily: 'monospace', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', resize: 'vertical',
	},
	input: {
		width: '100%', padding: '10px', borderRadius: '6px', fontSize: '13px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', color: 'var(--halo-text)',
	},
	row: { display: 'flex', gap: '8px', alignItems: 'center' },
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', marginBottom: '4px' },
	select: {
		padding: '8px 12px', borderRadius: '6px', fontSize: '12px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', color: 'var(--halo-text)',
	},
	btn: {
		padding: '8px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none',
	},
	resultBox: {
		padding: '12px', background: 'var(--halo-bg-secondary)', borderRadius: '8px',
		fontFamily: 'monospace', fontSize: '11px', wordBreak: 'break-all', cursor: 'pointer'
	}
};
