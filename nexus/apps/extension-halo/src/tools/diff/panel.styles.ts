// goal: Diff panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	inputRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
	textarea: {
		width: '100%', minHeight: '150px', padding: '10px', resize: 'vertical',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		borderRadius: '8px', color: 'var(--halo-text)', fontSize: '11px', fontFamily: 'monospace',
	},
	label: { fontSize: '10px', fontWeight: 600, color: 'var(--halo-text-muted)', marginBottom: '4px', display: 'block' },
	btn: {
		padding: '10px 20px', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none',
	},
	row: { display: 'flex', gap: '8px', alignItems: 'center' },
	stats: { display: 'flex', gap: '16px', fontSize: '12px', color: 'var(--halo-text-muted)' },
	statAdd: { color: 'var(--halo-success, #22c55e)' },
	statDel: { color: 'var(--halo-error, #ef4444)' },
	diffOutput: {
		padding: '12px', background: 'var(--halo-bg-secondary)', borderRadius: '8px',
		border: '1px solid var(--halo-border)', fontFamily: 'monospace', fontSize: '11px',
		maxHeight: '300px', overflowY: 'auto', whiteSpace: 'pre-wrap',
	},
	lineEqual: { color: 'var(--halo-text-muted)' },
	lineInsert: { background: 'rgba(34, 197, 94, 0.2)', color: 'var(--halo-success, #22c55e)' },
	lineDelete: { background: 'rgba(239, 68, 68, 0.2)', color: 'var(--halo-error, #ef4444)', textDecoration: 'line-through' },
};
