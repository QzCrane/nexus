// goal: CSP Analyzer panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' },
	textarea: {
		width: '100%', minHeight: '80px', padding: '12px', borderRadius: '8px', fontSize: '12px',
		fontFamily: 'monospace', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', resize: 'vertical',
	},
	list: {
		flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '8px',
	},
	card: {
		padding: '12px', borderRadius: '8px', background: 'var(--halo-bg-secondary)', border: '1px solid var(--halo-border)',
	},
	cardUnsafe: {
		padding: '12px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.3)',
	},
	name: { fontWeight: 700, fontSize: '13px', color: 'var(--halo-text)', marginBottom: '4px' },
	desc: { fontSize: '11px', color: 'var(--halo-text-muted)', marginBottom: '6px' },
	values: { display: 'flex', flexWrap: 'wrap', gap: '4px' },
	tag: {
		padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace',
		background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)',
	},
	tagUnsafe: {
		padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace',
		background: '#ef4444', color: '#fff',
	},
	score: {
		fontSize: '24px', fontWeight: 800, textAlign: 'center', marginBottom: '12px',
		color: 'var(--halo-accent)',
	},
};
