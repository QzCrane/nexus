// goal: Lorem Ipsum panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	row: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
	input: {
		width: '80px', padding: '8px 12px', textAlign: 'center',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		borderRadius: '6px', color: 'var(--halo-text)', fontSize: '14px', fontWeight: 600,
	},
	select: {
		padding: '8px 12px', borderRadius: '6px', fontSize: '12px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', cursor: 'pointer',
	},
	btn: {
		padding: '10px 20px', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none', transition: 'opacity 0.15s',
	},
	btnSecondary: {
		padding: '8px 14px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer',
		background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)', border: '1px solid var(--halo-border)',
	},
	checkbox: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--halo-text-muted)' },
	output: {
		width: '100%', minHeight: '200px', padding: '12px', resize: 'vertical',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		borderRadius: '8px', color: 'var(--halo-text)', fontSize: '12px', lineHeight: '1.6',
	},
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase' as const },
};
