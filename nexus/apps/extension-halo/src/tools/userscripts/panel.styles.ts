// goal: UserScripts panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	row: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase' as const },
	input: {
		flex: 1, padding: '8px 12px', background: 'var(--halo-bg-tertiary)',
		border: '1px solid var(--halo-border)', borderRadius: '6px', color: 'var(--halo-text)', fontSize: '12px',
	},
	textarea: {
		width: '100%', minHeight: '120px', padding: '10px 12px', resize: 'vertical',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		borderRadius: '8px', color: 'var(--halo-text)', fontSize: '11px', fontFamily: 'monospace',
	},
	select: {
		padding: '6px 10px', borderRadius: '6px', fontSize: '12px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', cursor: 'pointer',
	},
	btn: {
		padding: '8px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none', transition: 'opacity 0.15s',
	},
	btnSecondary: {
		padding: '6px 12px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer',
		background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)', border: '1px solid var(--halo-border)',
	},
	btnDanger: {
		padding: '4px 8px', borderRadius: '4px', fontSize: '10px', cursor: 'pointer',
		background: 'transparent', color: 'var(--halo-error, #ef4444)', border: 'none',
	},
	scriptCard: {
		display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px',
		background: 'var(--halo-bg-secondary)', borderRadius: '8px', border: '1px solid var(--halo-border)',
	},
	scriptHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
	scriptTitle: { fontSize: '13px', fontWeight: 600, color: 'var(--halo-text)' },
	scriptMeta: { fontSize: '10px', color: 'var(--halo-text-muted)' },
	toggle: { width: '36px', height: '20px', borderRadius: '10px', cursor: 'pointer', position: 'relative', transition: '0.2s' },
	toggleKnob: { width: '16px', height: '16px', borderRadius: '8px', background: '#fff', position: 'absolute', top: '2px', transition: '0.2s' },
	emptyState: { textAlign: 'center', padding: '40px 20px', color: 'var(--halo-text-muted)', fontSize: '13px' },
	badge: { fontSize: '9px', padding: '2px 6px', borderRadius: '4px', background: 'var(--halo-accent)', color: '#fff' },
};
