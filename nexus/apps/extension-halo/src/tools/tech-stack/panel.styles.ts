// goal: Tech Stack panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	btn: {
		width: '100%', padding: '14px', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none',
	},
	category: { marginBottom: '12px' },
	categoryTitle: { fontSize: '12px', fontWeight: 600, color: 'var(--halo-text-muted)', marginBottom: '8px' },
	list: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
	item: {
		display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px',
		background: 'var(--halo-bg-secondary)', borderRadius: '8px', border: '1px solid var(--halo-border)',
	},
	icon: { fontSize: '18px' },
	name: { fontSize: '13px', fontWeight: 600, color: 'var(--halo-text)' },
	version: { fontSize: '11px', color: 'var(--halo-text-muted)' },
	empty: { padding: '32px', textAlign: 'center', color: 'var(--halo-text-muted)', fontSize: '13px' },
	summary: {
		display: 'flex', justifyContent: 'space-around', padding: '16px',
		background: 'var(--halo-bg-secondary)', borderRadius: '8px', textAlign: 'center',
	},
	stat: { display: 'flex', flexDirection: 'column', gap: '4px' },
	statValue: { fontSize: '24px', fontWeight: 700, color: 'var(--halo-text)' },
	statLabel: { fontSize: '11px', color: 'var(--halo-text-muted)' },
};
