// goal: Password Generator panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	password: {
		padding: '16px', fontSize: '18px', fontWeight: 600, fontFamily: 'monospace',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		borderRadius: '8px', color: 'var(--halo-text)', textAlign: 'center', wordBreak: 'break-all',
	},
	row: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
	btn: {
		flex: 1, padding: '10px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none',
	},
	btnSecondary: {
		padding: '8px 12px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer',
		background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)', border: '1px solid var(--halo-border)',
	},
	config: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' },
	checkbox: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--halo-text)' },
	slider: { display: 'flex', alignItems: 'center', gap: '12px' },
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)' },
	strength: { padding: '8px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, textAlign: 'center' },
	list: { display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '150px', overflowY: 'auto' },
	listItem: {
		display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px',
		background: 'var(--halo-bg-secondary)', borderRadius: '6px', fontFamily: 'monospace', fontSize: '12px',
	},
};
