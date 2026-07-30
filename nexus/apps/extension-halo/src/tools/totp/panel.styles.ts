// goal: TOTP panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	addForm: { display: 'flex', flexDirection: 'column', gap: '8px' },
	input: {
		padding: '10px 12px', borderRadius: '6px', fontSize: '12px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', fontFamily: 'monospace',
	},
	row: { display: 'flex', gap: '8px', alignItems: 'center' },
	btn: {
		flex: 1, padding: '10px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none',
	},
	btnSecondary: {
		padding: '8px 12px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer',
		background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)', border: '1px solid var(--halo-border)',
	},
	list: { display: 'flex', flexDirection: 'column', gap: '8px' },
	item: {
		padding: '16px', background: 'var(--halo-bg-secondary)',
		borderRadius: '12px', border: '1px solid var(--halo-border)',
	},
	itemHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' },
	name: { fontSize: '13px', fontWeight: 600, color: 'var(--halo-text)' },
	issuer: { fontSize: '11px', color: 'var(--halo-text-muted)' },
	code: { fontSize: '32px', fontWeight: 700, fontFamily: 'monospace', letterSpacing: '4px', color: 'var(--halo-text)' },
	error: { marginTop: '6px', fontSize: '11px', color: '#ef4444' },
	timer: {
		display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px',
		fontSize: '12px', color: 'var(--halo-text-muted)',
	},
	progress: { flex: 1, height: '4px', borderRadius: '2px', background: 'var(--halo-bg-tertiary)', overflow: 'hidden' },
	progressBar: { height: '100%', background: 'var(--halo-accent)', transition: 'width 1s linear' },
	empty: { padding: '32px', textAlign: 'center', color: 'var(--halo-text-muted)', fontSize: '13px' },
};
