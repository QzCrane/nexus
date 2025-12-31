// goal: User-Agent Switcher panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	current: { padding: '12px', background: 'var(--halo-bg-secondary)', borderRadius: '8px' },
	label: { fontSize: '10px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase', marginBottom: '4px' },
	value: { fontSize: '11px', fontFamily: 'monospace', color: 'var(--halo-text)', wordBreak: 'break-all' },
	info: { display: 'flex', gap: '8px', marginTop: '8px' },
	badge: { padding: '4px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 600, background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)' },
	list: { display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '300px', overflowY: 'auto' },
	item: {
		display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px',
		background: 'var(--halo-bg-secondary)', borderRadius: '8px', cursor: 'pointer',
	},
	icon: { fontSize: '18px' },
	name: { flex: 1, fontSize: '12px', fontWeight: 500, color: 'var(--halo-text)' },
	copyBtn: {
		padding: '4px 8px', borderRadius: '4px', fontSize: '10px', cursor: 'pointer',
		background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-muted)', border: 'none',
	},
	section: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', padding: '8px 0 4px', borderBottom: '1px solid var(--halo-border)' },
};
