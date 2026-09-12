// goal: Table Extractor panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	exportControl: { display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'space-between' },
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)' },
	select: {
		padding: '7px 9px', borderRadius: '6px', fontSize: '11px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', color: 'var(--halo-text)',
	},
	notice: {
		padding: '8px 10px', borderRadius: '6px', fontSize: '11px', lineHeight: 1.4,
		background: 'var(--halo-bg-secondary)', color: 'var(--halo-text-muted)',
	},
	btn: {
		width: '100%', padding: '14px', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none',
	},
	tableCard: {
		padding: '12px', background: 'var(--halo-bg-secondary)', borderRadius: '8px',
		border: '1px solid var(--halo-border)',
	},
	tableHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' },
	tableTitle: { fontSize: '13px', fontWeight: 600, color: 'var(--halo-text)' },
	tableInfo: { fontSize: '11px', color: 'var(--halo-text-muted)' },
	actions: { display: 'flex', gap: '6px' },
	actionBtn: {
		padding: '6px 10px', borderRadius: '4px', fontSize: '10px', cursor: 'pointer',
		background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)', border: 'none',
	},
	preview: { maxHeight: '150px', overflowX: 'auto', overflowY: 'auto' },
	table: { width: '100%', borderCollapse: 'collapse', fontSize: '10px' },
	th: { padding: '4px 6px', background: 'var(--halo-bg-tertiary)', fontWeight: 600, textAlign: 'left', borderBottom: '1px solid var(--halo-border)' },
	td: { padding: '4px 6px', borderBottom: '1px solid var(--halo-border)' },
	empty: { padding: '32px', textAlign: 'center', color: 'var(--halo-text-muted)' },
	loading: { padding: '24px', textAlign: 'center' },
	error: { padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '6px', color: 'var(--halo-error, #ef4444)', fontSize: '11px' },
};
