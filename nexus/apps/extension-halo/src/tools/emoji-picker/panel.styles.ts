// goal: Emoji Picker panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	search: {
		width: '100%', padding: '12px 16px', borderRadius: '8px', fontSize: '14px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', color: 'var(--halo-text)',
	},
	tabs: { display: 'flex', gap: '4px', overflowX: 'auto' },
	tab: { padding: '8px 12px', borderRadius: '6px', fontSize: '16px', cursor: 'pointer', border: 'none', background: 'transparent' },
	grid: { display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '4px', maxHeight: '300px', overflowY: 'auto' },
	emoji: { fontSize: '24px', padding: '6px', textAlign: 'center', cursor: 'pointer', borderRadius: '4px', border: 'none', background: 'transparent' },
	recent: { padding: '8px', background: 'var(--halo-bg-secondary)', borderRadius: '8px', marginBottom: '8px' },
	recentLabel: { fontSize: '10px', fontWeight: 600, color: 'var(--halo-text-muted)', marginBottom: '8px' },
};
