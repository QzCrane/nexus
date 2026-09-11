// goal: Timer panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' },
	tabs: { display: 'flex', gap: '4px', width: '100%' },
	tab: {
		flex: 1, padding: '10px', textAlign: 'center', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
		cursor: 'pointer', border: 'none', transition: 'var(--halo-motion-transition, all 0.15s)',
	},
	active: { background: 'var(--halo-accent)', color: '#fff' },
	inactive: { background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-muted)' },
	display: {
		fontSize: '48px', fontWeight: 700, fontFamily: 'monospace', color: 'var(--halo-text)', padding: '24px 0',
	},
	controls: { display: 'flex', gap: '12px' },
	btn: {
		padding: '14px 28px', borderRadius: '12px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none',
	},
	btnSecondary: {
		padding: '12px 20px', borderRadius: '8px', fontSize: '12px', cursor: 'pointer',
		background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)', border: '1px solid var(--halo-border)',
	},
	presets: { display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center' },
	preset: { padding: '6px 12px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', background: 'var(--halo-bg-tertiary)', border: 'none', color: 'var(--halo-text)' },
	laps: { width: '100%', maxHeight: '150px', overflowY: 'auto' },
	lap: {
		display: 'flex', justifyContent: 'space-between', padding: '8px 12px',
		background: 'var(--halo-bg-secondary)', borderRadius: '6px', marginBottom: '4px', fontSize: '12px',
	},
	input: {
		width: '60px', padding: '8px', textAlign: 'center', borderRadius: '6px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', fontSize: '18px', fontWeight: 600,
	},
	inputRow: { display: 'flex', gap: '8px', alignItems: 'center' },
};
