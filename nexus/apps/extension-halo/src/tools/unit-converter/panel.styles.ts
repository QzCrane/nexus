// goal: Unit Converter panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	tabs: { display: 'flex', gap: '4px', flexWrap: 'wrap' },
	tab: {
		padding: '6px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 500,
		cursor: 'pointer', border: 'none', transition: 'all 0.15s',
	},
	active: { background: 'var(--halo-accent)', color: '#fff' },
	inactive: { background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-muted)' },
	inputSection: { display: 'flex', gap: '12px', alignItems: 'flex-start' },
	inputGroup: { flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' },
	label: { fontSize: '10px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase' as const },
	input: {
		padding: '12px', fontSize: '16px', fontWeight: 600, textAlign: 'center',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		borderRadius: '8px', color: 'var(--halo-text)',
	},
	select: {
		padding: '10px', borderRadius: '6px', fontSize: '12px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', cursor: 'pointer',
	},
	swapBtn: {
		padding: '8px 12px', borderRadius: '50%', fontSize: '16px', cursor: 'pointer',
		background: 'var(--halo-bg-secondary)', color: 'var(--halo-text)', border: '1px solid var(--halo-border)',
		alignSelf: 'center', marginTop: '20px',
	},
	result: {
		padding: '16px', textAlign: 'center', background: 'var(--halo-bg-secondary)',
		borderRadius: '8px', border: '1px solid var(--halo-border)',
	},
	resultValue: { fontSize: '24px', fontWeight: 700, color: 'var(--halo-text)' },
	resultUnit: { fontSize: '12px', color: 'var(--halo-text-muted)', marginTop: '4px' },
};
