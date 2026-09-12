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
	name: { fontWeight: 700, fontSize: '13px', color: 'var(--halo-text)', marginBottom: '4px' },
	policyText: { display: 'block', overflowWrap: 'anywhere', marginBottom: '6px', fontSize: '10px', color: 'var(--halo-text)' },
	desc: { fontSize: '11px', color: 'var(--halo-text-muted)', marginBottom: '6px' },
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)' },
	boundary: { padding: '8px', borderRadius: '6px', fontSize: '11px', color: 'var(--halo-text-muted)', background: 'var(--halo-bg-secondary)' },
	status: { fontSize: '15px', fontWeight: 700, color: 'var(--halo-text)' },
	fact: { fontSize: '11px', color: 'var(--halo-text-muted)' },
	error: { color: '#ef4444', fontSize: '12px' },
	duplicate: { padding: '6px', marginBottom: '6px', borderRadius: '4px', color: '#f59e0b', background: 'rgba(245, 158, 11, 0.08)', fontSize: '11px' },
	finding: { display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '6px 0', borderTop: '1px solid var(--halo-border)' },
	findingText: { flex: 1, fontSize: '11px', color: 'var(--halo-text-muted)' },
	'risk-high': { color: '#ef4444', fontSize: '10px', fontWeight: 700 },
	'risk-syntax': { color: '#ef4444', fontSize: '10px', fontWeight: 700 },
	'risk-medium': { color: '#f59e0b', fontSize: '10px', fontWeight: 700 },
	'risk-recommendation': { color: '#8b5cf6', fontSize: '10px', fontWeight: 700 },
	'risk-info': { color: '#3b82f6', fontSize: '10px', fontWeight: 700 },
	'risk-effective': { color: 'var(--halo-text-muted)', fontSize: '10px', fontWeight: 700 },
};
