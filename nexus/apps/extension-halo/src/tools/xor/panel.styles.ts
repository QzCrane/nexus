// goal: XOR panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	textarea: {
		width: '100%', minHeight: '80px', padding: '12px', borderRadius: '8px', fontSize: '13px',
		fontFamily: 'monospace', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', resize: 'vertical',
	},
	input: {
		width: '100%', padding: '10px', borderRadius: '6px', fontSize: '13px', fontFamily: 'monospace',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', color: 'var(--halo-text)',
	},
	row: { display: 'flex', flexDirection: 'column', gap: '4px' },
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)' },
	checkbox: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer', color: 'var(--halo-text)' },
};
