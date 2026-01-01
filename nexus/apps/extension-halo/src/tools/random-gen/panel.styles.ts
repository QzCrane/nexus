// goal: Random Gen panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	textarea: {
		width: '100%', minHeight: '120px', padding: '12px', borderRadius: '8px', fontSize: '13px',
		fontFamily: 'monospace', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', resize: 'vertical',
	},
	toolbar: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' },
	item: { marginBottom: '16px' },
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', marginBottom: '4px', display: 'block' },
	select: {
		padding: '8px 12px', borderRadius: '6px', fontSize: '12px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', color: 'var(--halo-text)',
	},
	input: {
		padding: '8px', borderRadius: '6px', fontSize: '12px', width: '80px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', color: 'var(--halo-text)',
	},
	btn: {
		padding: '8px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none',
	},
};
