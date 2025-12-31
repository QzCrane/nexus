// goal: HTTP Status panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	search: {
		width: '100%', padding: '12px 16px', borderRadius: '8px', fontSize: '14px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)',
	},
	list: { display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '400px', overflowY: 'auto' },
	item: {
		display: 'flex', alignItems: 'center', gap: '12px', padding: '12px',
		background: 'var(--halo-bg-secondary)', borderRadius: '8px', cursor: 'pointer',
	},
	code: { fontSize: '18px', fontWeight: 700, fontFamily: 'monospace', minWidth: '50px' },
	info: { flex: 1 },
	name: { fontSize: '13px', fontWeight: 600, color: 'var(--halo-text)' },
	desc: { fontSize: '11px', color: 'var(--halo-text-muted)', marginTop: '2px' },
	category: { padding: '4px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 600, background: 'rgba(0,0,0,0.1)' },
	sectionTitle: {
		fontSize: '12px', fontWeight: 600, color: 'var(--halo-text-muted)', padding: '8px 0 4px',
		borderBottom: '1px solid var(--halo-border)', marginTop: '8px',
	},
};
