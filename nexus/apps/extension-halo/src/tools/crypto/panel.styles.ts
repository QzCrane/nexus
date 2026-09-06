// goal: Crypto panel shared styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	tabs: { display: 'flex', gap: '4px' },
	tab: {
		flex: 1, padding: '8px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
		cursor: 'pointer', transition: 'var(--halo-motion-transition, all 0.15s)', border: '1px solid var(--halo-border)', textAlign: 'center',
	},
	active: { background: 'var(--halo-accent)', color: '#fff', borderColor: 'var(--halo-accent)' },
	inactive: { background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-secondary)' },
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase' as const },
	textarea: {
		width: '100%', minHeight: '80px', padding: '10px 12px', resize: 'vertical',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		borderRadius: '8px', color: 'var(--halo-text)', fontSize: '12px', fontFamily: 'monospace',
	},
	input: {
		width: '100%', padding: '8px 12px', background: 'var(--halo-bg-tertiary)',
		border: '1px solid var(--halo-border)', borderRadius: '6px', color: 'var(--halo-text)', fontSize: '12px',
	},
	btn: {
		padding: '8px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none', transition: 'var(--halo-motion-transition, opacity 0.15s)',
	},
	btnSecondary: {
		padding: '6px 12px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer',
		background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)', border: '1px solid var(--halo-border)',
	},
	resultBox: {
		padding: '10px', background: 'var(--halo-bg-secondary)', borderRadius: '6px',
		fontSize: '11px', fontFamily: 'monospace', wordBreak: 'break-all', border: '1px solid var(--halo-border)',
		maxHeight: '200px', overflow: 'auto',
	},
	row: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
	error: { color: 'var(--halo-error, #ef4444)', fontSize: '11px' },
	success: { color: 'var(--halo-success, #22c55e)', fontSize: '11px' },
};
