// goal: Code Formatter panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	langTabs: { display: 'flex', gap: '4px', flexWrap: 'wrap' },
	langTab: {
		padding: '6px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
		cursor: 'pointer', border: 'none', transition: 'all 0.15s',
	},
	active: { background: 'var(--halo-accent)', color: '#fff' },
	inactive: { background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-muted)' },
	textarea: {
		width: '100%', minHeight: '200px', padding: '12px', resize: 'vertical',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		borderRadius: '8px', color: 'var(--halo-text)', fontSize: '11px', fontFamily: 'monospace',
	},
	row: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
	btn: {
		padding: '10px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none',
	},
	btnSecondary: {
		padding: '8px 12px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer',
		background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)', border: '1px solid var(--halo-border)',
	},
	config: { display: 'flex', gap: '12px', alignItems: 'center' },
	label: { fontSize: '10px', fontWeight: 600, color: 'var(--halo-text-muted)' },
	input: {
		width: '60px', padding: '6px', textAlign: 'center',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		borderRadius: '4px', color: 'var(--halo-text)', fontSize: '12px',
	},
	error: { padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '6px', color: 'var(--halo-error, #ef4444)', fontSize: '11px' },
};
