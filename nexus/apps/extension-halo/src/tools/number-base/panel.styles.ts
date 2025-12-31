// goal: Number Base panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	inputSection: { padding: '12px', background: 'var(--halo-bg-secondary)', borderRadius: '8px' },
	row: { display: 'flex', gap: '8px', alignItems: 'center' },
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', width: '80px' },
	input: {
		flex: 1, padding: '10px 12px', fontFamily: 'monospace', fontSize: '14px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		borderRadius: '6px', color: 'var(--halo-text)',
	},
	select: {
		padding: '10px 12px', borderRadius: '6px', fontSize: '12px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', cursor: 'pointer',
	},
	resultCard: {
		display: 'flex', justifyContent: 'space-between', alignItems: 'center',
		padding: '12px', background: 'var(--halo-bg-secondary)', borderRadius: '8px', border: '1px solid var(--halo-border)',
	},
	resultLabel: { fontSize: '12px', fontWeight: 600, color: 'var(--halo-text-muted)' },
	resultValue: { fontSize: '14px', fontWeight: 600, color: 'var(--halo-text)', fontFamily: 'monospace' },
	btnCopy: {
		padding: '4px 8px', borderRadius: '4px', fontSize: '10px', cursor: 'pointer',
		background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-muted)', border: '1px solid var(--halo-border)',
	},
	error: { padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '6px', color: 'var(--halo-error, #ef4444)', fontSize: '11px' },
};
