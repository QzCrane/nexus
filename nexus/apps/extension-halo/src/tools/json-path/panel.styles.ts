// goal: JSONPath panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	input: {
		width: '100%', padding: '12px', borderRadius: '8px', fontSize: '13px', fontFamily: 'monospace',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', color: 'var(--halo-text)',
	},
	textarea: {
		width: '100%', minHeight: '120px', padding: '12px', borderRadius: '8px', fontSize: '11px',
		fontFamily: 'monospace', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', resize: 'vertical',
	},
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', marginBottom: '4px' },
	examples: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
	example: {
		padding: '4px 8px', borderRadius: '4px', fontSize: '10px', fontFamily: 'monospace', cursor: 'pointer',
		background: 'var(--halo-bg-secondary)', color: 'var(--halo-text-muted)', border: 'none',
	},
	result: { padding: '12px', background: 'var(--halo-bg-secondary)', borderRadius: '8px' },
	count: { fontSize: '11px', color: 'var(--halo-text-muted)', marginBottom: '8px' },
};
