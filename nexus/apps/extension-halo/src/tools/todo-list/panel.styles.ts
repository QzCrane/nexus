// goal: Todo List panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	inputRow: { display: 'flex', gap: '8px' },
	input: {
		flex: 1, padding: '12px 14px', borderRadius: '8px', fontSize: '13px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)',
	},
	btn: {
		padding: '12px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none',
	},
	list: { display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '350px', overflowY: 'auto' },
	item: {
		display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px',
		background: 'var(--halo-bg-secondary)', borderRadius: '8px',
	},
	checkbox: { width: '18px', height: '18px', cursor: 'pointer', accentColor: 'var(--halo-accent)' },
	text: { flex: 1, fontSize: '13px', color: 'var(--halo-text)' },
	textCompleted: { textDecoration: 'line-through', opacity: 0.5 },
	priority: { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0 },
	deleteBtn: {
		padding: '4px 8px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer',
		background: 'transparent', color: 'var(--halo-text-muted)', border: 'none',
	},
	footer: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--halo-text-muted)' },
	empty: { padding: '32px', textAlign: 'center', color: 'var(--halo-text-muted)' },
};
