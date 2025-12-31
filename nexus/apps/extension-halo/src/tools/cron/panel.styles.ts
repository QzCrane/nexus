// goal: Cron panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	input: {
		width: '100%', padding: '14px', fontSize: '18px', fontWeight: 600, textAlign: 'center',
		fontFamily: 'monospace', letterSpacing: '2px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		borderRadius: '8px', color: 'var(--halo-text)',
	},
	description: {
		padding: '16px', textAlign: 'center', fontSize: '14px', fontWeight: 500,
		background: 'var(--halo-bg-secondary)', borderRadius: '8px', color: 'var(--halo-text)',
	},
	parts: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' },
	part: {
		padding: '8px', textAlign: 'center', background: 'var(--halo-bg-tertiary)',
		borderRadius: '6px', border: '1px solid var(--halo-border)',
	},
	partLabel: { fontSize: '9px', color: 'var(--halo-text-muted)', textTransform: 'uppercase' as const, marginBottom: '4px' },
	partValue: { fontSize: '14px', fontWeight: 600, color: 'var(--halo-text)', fontFamily: 'monospace' },
	presets: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
	preset: {
		padding: '6px 10px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer',
		background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-muted)', border: '1px solid var(--halo-border)',
	},
	label: { fontSize: '10px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase' as const, marginBottom: '6px' },
	nextRuns: { padding: '12px', background: 'var(--halo-bg-secondary)', borderRadius: '8px' },
	runItem: { fontSize: '12px', color: 'var(--halo-text)', padding: '4px 0', borderBottom: '1px solid var(--halo-border)' },
};
