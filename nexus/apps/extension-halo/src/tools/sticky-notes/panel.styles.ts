// goal: Sticky Notes panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
	title: { fontSize: '14px', fontWeight: 600, color: 'var(--halo-text)' },
	btn: {
		padding: '8px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none',
	},
	grid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' },
	note: {
		padding: '12px', borderRadius: '8px', minHeight: '100px', position: 'relative',
		boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
	},
	textarea: {
		width: '100%', height: '80px', border: 'none', background: 'transparent',
		resize: 'none', fontSize: '12px', lineHeight: 1.5, outline: 'none',
	},
	noteActions: {
		display: 'flex', gap: '4px', position: 'absolute', top: '8px', right: '8px', opacity: 0,
		transition: 'var(--halo-motion-transition, opacity 0.15s)',
	},
	colorDot: {
		width: '16px', height: '16px', borderRadius: '50%', cursor: 'pointer', border: '2px solid transparent',
	},
	actionBtn: {
		width: '20px', height: '20px', borderRadius: '4px', cursor: 'pointer',
		background: 'rgba(0,0,0,0.1)', border: 'none', fontSize: '10px',
	},
	empty: { padding: '32px', textAlign: 'center', color: 'var(--halo-text-muted)', fontSize: '13px' },
	colors: { display: 'flex', gap: '6px', marginTop: '8px' },
};
