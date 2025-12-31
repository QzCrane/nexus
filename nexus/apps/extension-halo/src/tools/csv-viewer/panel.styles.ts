// goal: CSV Viewer panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	textarea: {
		width: '100%', minHeight: '100px', padding: '12px', borderRadius: '8px', fontSize: '12px',
		fontFamily: 'monospace', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', resize: 'vertical',
	},
	row: { display: 'flex', gap: '8px', alignItems: 'center' },
	btn: {
		padding: '8px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none',
	},
	select: {
		padding: '8px 12px', borderRadius: '6px', fontSize: '12px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)',
	},
	stats: { fontSize: '11px', color: 'var(--halo-text-muted)' },
	tableWrap: { overflowX: 'auto', maxHeight: '300px', overflowY: 'auto' },
	table: { width: '100%', borderCollapse: 'collapse', fontSize: '11px' },
	th: {
		padding: '8px 12px', background: 'var(--halo-bg-tertiary)', fontWeight: 600,
		textAlign: 'left', position: 'sticky', top: 0, borderBottom: '2px solid var(--halo-border)',
	},
	td: { padding: '6px 12px', borderBottom: '1px solid var(--halo-border)', wordBreak: 'break-word' },
	empty: { padding: '32px', textAlign: 'center', color: 'var(--halo-text-muted)', fontSize: '13px' },
};
