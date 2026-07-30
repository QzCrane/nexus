// goal: Styles for RegexPanel
// eff: Extracted to separate file

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	row: { display: 'flex', gap: '8px', alignItems: 'center' },
	input: {
		flex: 1, padding: '10px 12px', background: 'var(--halo-bg-tertiary)',
		border: '1px solid var(--halo-border)', borderRadius: '8px',
		color: 'var(--halo-text)', fontSize: '12px', fontFamily: 'monospace',
	},
	textarea: {
		width: '100%', minHeight: '120px', padding: '10px 12px', resize: 'vertical',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		borderRadius: '8px', color: 'var(--halo-text)', fontSize: '12px', fontFamily: 'monospace',
	},
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase' as const },
	flagBtn: {
		padding: '6px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
		cursor: 'pointer', transition: 'all 0.15s', border: '1px solid var(--halo-border)',
	},
	flagActive: { background: 'var(--halo-accent)', color: '#fff', borderColor: 'var(--halo-accent)' },
	flagInactive: { background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-muted)' },
	presetBtn: {
		padding: '4px 8px', borderRadius: '4px', fontSize: '10px',
		background: 'var(--halo-bg-secondary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text-secondary)', cursor: 'pointer',
	},
	matchItem: {
		padding: '8px', background: 'var(--halo-bg-secondary)', borderRadius: '6px',
		fontSize: '11px', fontFamily: 'monospace',
	},
	matchText: { color: 'var(--halo-accent)', fontWeight: 600 },
	matchMeta: { color: 'var(--halo-text-muted)', fontSize: '10px', marginTop: '4px' },
	error: { color: '#ef4444', fontSize: '11px', padding: '8px', background: 'rgba(239,68,68,0.1)', borderRadius: '6px' },
	count: { fontSize: '12px', color: 'var(--halo-text-secondary)', fontWeight: 500 },
};
