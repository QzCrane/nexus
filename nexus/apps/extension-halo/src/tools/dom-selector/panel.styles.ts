// goal: DOM Selector panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	textarea: {
		width: '100%', minHeight: '60px', padding: '12px', borderRadius: '8px', fontSize: '12px',
		fontFamily: 'monospace', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', resize: 'vertical',
	},
	btn: {
		padding: '12px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px'
	},
	btnActive: {
		padding: '12px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
		background: '#ef4444', color: '#fff', border: 'none', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px'
	},
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', marginBottom: '4px' },
	copyBtn: {
		padding: '6px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-bg-secondary)', color: 'var(--halo-text)', border: '1px solid var(--halo-border)',
		marginLeft: 'auto'
	},
	header: { display: 'flex', alignItems: 'center' }
};
