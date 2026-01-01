// goal: ROT13 panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	toolbar: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
	textarea: {
		width: '100%', minHeight: '120px', padding: '12px', borderRadius: '8px', fontSize: '13px',
		fontFamily: 'monospace', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', resize: 'vertical',
	},
	btn: {
		padding: '8px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)', border: '1px solid var(--halo-border)',
	},
	activeBtn: {
		padding: '8px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none',
	},
	sliderContainer: { display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '150px' },
	slider: { flex: 1, cursor: 'pointer' },
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', marginBottom: '4px' },
};
