// goal: JWT Decoder panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	textarea: {
		width: '100%', minHeight: '80px', padding: '12px', borderRadius: '8px', fontSize: '11px',
		fontFamily: 'monospace', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', resize: 'vertical',
	},
	section: { padding: '12px', background: 'var(--halo-bg-secondary)', borderRadius: '8px' },
	sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' },
	sectionTitle: { fontSize: '12px', fontWeight: 600, color: 'var(--halo-text)' },
	badge: { padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 600, color: '#fff' },
	code: { fontSize: '11px', fontFamily: 'monospace', color: 'var(--halo-text)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
	row: { display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--halo-border)' },
	key: { fontSize: '11px', color: 'var(--halo-text-muted)', fontWeight: 600 },
	value: { fontSize: '11px', color: 'var(--halo-text)', textAlign: 'right', maxWidth: '60%', wordBreak: 'break-all' },
	error: { padding: '16px', textAlign: 'center', color: 'var(--halo-text-muted)' },
	expired: { background: '#ef4444' },
	valid: { background: '#22c55e' },
};
