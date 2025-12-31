// goal: Markdown panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' },
	tabs: { display: 'flex', gap: '4px' },
	tab: {
		flex: 1, padding: '8px', textAlign: 'center', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
		cursor: 'pointer', border: 'none', transition: 'all 0.15s',
	},
	active: { background: 'var(--halo-accent)', color: '#fff' },
	inactive: { background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-muted)' },
	editor: { display: 'flex', flex: 1, gap: '12px', minHeight: 0 },
	textarea: {
		flex: 1, padding: '12px', resize: 'none',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		borderRadius: '8px', color: 'var(--halo-text)', fontSize: '12px', fontFamily: 'monospace',
	},
	preview: {
		flex: 1, padding: '12px', overflowY: 'auto',
		background: 'var(--halo-bg-secondary)', border: '1px solid var(--halo-border)',
		borderRadius: '8px', fontSize: '13px',
	},
	row: { display: 'flex', gap: '8px', alignItems: 'center' },
	btn: {
		padding: '6px 12px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer',
		background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)', border: '1px solid var(--halo-border)',
	},
};
