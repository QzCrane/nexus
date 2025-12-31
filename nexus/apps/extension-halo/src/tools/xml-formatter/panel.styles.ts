// goal: XML Formatter panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	textarea: {
		width: '100%', minHeight: '200px', padding: '12px', borderRadius: '8px', fontSize: '12px',
		fontFamily: 'monospace', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', resize: 'vertical',
	},
	row: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
	btn: {
		flex: 1, padding: '10px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none',
	},
	btnSecondary: {
		padding: '10px 16px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer',
		background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)', border: '1px solid var(--halo-border)',
	},
	stats: {
		display: 'flex', gap: '16px', padding: '12px', background: 'var(--halo-bg-secondary)',
		borderRadius: '8px', fontSize: '12px',
	},
	stat: { display: 'flex', alignItems: 'center', gap: '4px' },
	statLabel: { color: 'var(--halo-text-muted)' },
	statValue: { fontWeight: 600, color: 'var(--halo-text)' },
	valid: { color: '#22c55e' },
	invalid: { color: '#ef4444' },
	error: { padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '6px', fontSize: '11px', color: '#ef4444' },
};
