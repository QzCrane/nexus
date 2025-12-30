// goal: Styles for Base64Panel
// eff: Extracted to separate file

import React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	row: { display: 'flex', gap: '8px', alignItems: 'center' },
	textarea: {
		width: '100%', minHeight: '100px', padding: '10px 12px', resize: 'vertical',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		borderRadius: '8px', color: 'var(--halo-text)', fontSize: '12px', fontFamily: 'monospace',
	},
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase' as const },
	modeBtn: {
		flex: 1, padding: '10px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
		cursor: 'pointer', transition: 'all 0.15s', border: '1px solid var(--halo-border)',
	},
	active: { background: 'var(--halo-accent)', color: '#fff', borderColor: 'var(--halo-accent)' },
	inactive: { background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-secondary)' },
	checkbox: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' },
	actionBtn: {
		padding: '8px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: 500,
		cursor: 'pointer', border: 'none', transition: 'all 0.15s',
	},
	primaryBtn: { background: 'var(--halo-accent)', color: '#fff' },
	secondaryBtn: { background: 'var(--halo-bg-secondary)', color: 'var(--halo-text)', border: '1px solid var(--halo-border)' },
	error: { color: '#ef4444', fontSize: '11px', padding: '8px', background: 'rgba(239,68,68,0.1)', borderRadius: '6px' },
	info: { fontSize: '11px', color: 'var(--halo-text-muted)' },
	dropZone: {
		padding: '20px', border: '2px dashed var(--halo-border)', borderRadius: '8px',
		textAlign: 'center', color: 'var(--halo-text-muted)', fontSize: '12px', cursor: 'pointer',
	},
};
