// goal: Styles for HashPanel

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	textarea: {
		width: '100%', minHeight: '60px', padding: '10px 12px', resize: 'vertical',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		borderRadius: '8px', color: 'var(--halo-text)', fontSize: '12px', fontFamily: 'monospace',
	},
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase' as const },
	resultRow: {
		display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px',
		background: 'var(--halo-bg-secondary)', borderRadius: '6px', border: '1px solid var(--halo-border)',
	},
	algoLabel: {
		fontSize: '10px', fontWeight: 700, color: 'var(--halo-accent)', minWidth: '60px',
		fontFamily: 'monospace', textTransform: 'uppercase' as const,
	},
	hashValue: {
		flex: 1, fontSize: '10px', fontFamily: 'monospace', wordBreak: 'break-all',
		color: 'var(--halo-text)', lineHeight: 1.4,
	},
	copyBtn: {
		padding: '4px 8px', borderRadius: '4px', fontSize: '10px', flexShrink: 0,
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text-secondary)', cursor: 'pointer', transition: 'var(--halo-motion-transition, all 0.15s)',
	},
	copyBtnSuccess: { background: 'var(--halo-accent)', color: '#fff', borderColor: 'var(--halo-accent)' },
	dropZone: {
		padding: '16px', border: '2px dashed var(--halo-border)', borderRadius: '8px',
		textAlign: 'center', color: 'var(--halo-text-muted)', fontSize: '12px', cursor: 'pointer',
	},
	optionsRow: {
		display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px',
	},
	resultsGrid: { display: 'flex', flexDirection: 'column', gap: '6px' },
	verifySection: { marginTop: '10px', padding: '10px', background: 'var(--halo-bg-secondary)', borderRadius: '8px', border: '1px solid var(--halo-border)' },
	verifyInput: { width: '100%', padding: '6px 10px', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', borderRadius: '6px', color: 'var(--halo-text)', fontSize: '11px' },
	verifyBadge: { padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 700, color: '#fff' },
	pass: { background: '#22c55e' },
	fail: { background: '#ef4444' },
};
