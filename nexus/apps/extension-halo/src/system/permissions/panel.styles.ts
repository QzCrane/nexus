// goal: Permission panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	header: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' },
	title: { fontSize: '14px', fontWeight: 600, color: 'var(--halo-text)' },
	subtitle: { fontSize: '11px', color: 'var(--halo-text-muted)' },
	category: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase' as const, marginTop: '8px' },
	card: {
		display: 'flex', alignItems: 'center', gap: '12px', padding: '12px',
		background: 'var(--halo-bg-secondary)', borderRadius: '8px', border: '1px solid var(--halo-border)',
	},
	icon: { fontSize: '24px', width: '32px', textAlign: 'center' },
	info: { flex: 1 },
	name: { fontSize: '13px', fontWeight: 600, color: 'var(--halo-text)' },
	desc: { fontSize: '10px', color: 'var(--halo-text-muted)', marginTop: '2px' },
	requiredBy: { fontSize: '9px', color: 'var(--halo-accent)', marginTop: '4px' },
	btn: {
		padding: '6px 14px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
		border: 'none', transition: 'var(--halo-motion-transition, all 0.15s)',
	},
	btnGrant: { background: 'var(--halo-accent)', color: '#fff' },
	btnRevoke: { background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)', border: '1px solid var(--halo-border)' },
	badge: { fontSize: '9px', padding: '2px 6px', borderRadius: '4px', background: 'var(--halo-success, #22c55e)', color: '#fff' },
	badgeWarn: { fontSize: '9px', padding: '2px 6px', borderRadius: '4px', background: 'var(--halo-warning, #f59e0b)', color: '#fff' },
	warning: {
		display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', borderRadius: '8px',
		background: 'var(--halo-warning, #f59e0b)20', border: '1px solid var(--halo-warning, #f59e0b)',
		fontSize: '11px', color: 'var(--halo-text-muted)',
	},
};
