// goal: Text-to-Speech panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	textarea: {
		width: '100%', minHeight: '120px', padding: '12px', borderRadius: '8px', fontSize: '13px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', resize: 'vertical',
	},
	controls: { display: 'flex', gap: '8px', justifyContent: 'center' },
	btn: {
		padding: '12px 24px', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none',
	},
	btnSecondary: {
		padding: '12px 16px', borderRadius: '8px', fontSize: '14px', cursor: 'pointer',
		background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)', border: '1px solid var(--halo-border)',
	},
	settings: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '12px', background: 'var(--halo-bg-secondary)', borderRadius: '8px' },
	row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
	label: { fontSize: '12px', color: 'var(--halo-text-muted)' },
	select: {
		flex: 1, marginLeft: '8px', padding: '8px', borderRadius: '4px', fontSize: '12px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', color: 'var(--halo-text)',
	},
	slider: { flex: 1, marginLeft: '8px', accentColor: 'var(--halo-accent)' },
	value: { width: '40px', textAlign: 'right', fontSize: '12px', color: 'var(--halo-text)' },
};
