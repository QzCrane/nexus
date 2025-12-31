// goal: YAML panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	tabs: { display: 'flex', gap: '4px' },
	tab: {
		flex: 1, padding: '10px', textAlign: 'center', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
		border: 'none', transition: 'all 0.15s',
	},
	active: { background: 'var(--halo-accent)', color: '#fff' },
	inactive: { background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-muted)' },
	textarea: {
		width: '100%', minHeight: '180px', padding: '12px', resize: 'vertical',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		borderRadius: '8px', color: 'var(--halo-text)', fontSize: '11px', fontFamily: 'monospace',
	},
	row: { display: 'flex', gap: '8px', alignItems: 'center' },
	btn: {
		flex: 1, padding: '10px', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none',
	},
	btnSecondary: {
		padding: '8px 14px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer',
		background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)', border: '1px solid var(--halo-border)',
	},
	label: { fontSize: '10px', fontWeight: 600, color: 'var(--halo-text-muted)', marginBottom: '4px', display: 'block' },
	error: { padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '6px', color: 'var(--halo-error, #ef4444)', fontSize: '11px' },
};
