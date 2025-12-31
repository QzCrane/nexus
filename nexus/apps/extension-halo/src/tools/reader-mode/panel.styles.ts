// goal: Reader Mode panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
	title: { fontSize: '14px', fontWeight: 600, color: 'var(--halo-text)' },
	row: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
	btn: {
		flex: 1, padding: '12px', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none',
	},
	themeBtn: {
		flex: 1, padding: '10px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer',
		border: '2px solid transparent', textAlign: 'center',
	},
	slider: { display: 'flex', alignItems: 'center', gap: '12px' },
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', minWidth: '70px' },
	select: {
		flex: 1, padding: '8px 12px', borderRadius: '6px', fontSize: '12px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', cursor: 'pointer',
	},
	preview: {
		padding: '16px', borderRadius: '8px', maxHeight: '300px', overflowY: 'auto',
	},
	previewTitle: { fontSize: '20px', fontWeight: 700, marginBottom: '8px' },
	previewMeta: { fontSize: '12px', opacity: 0.7, marginBottom: '16px' },
	empty: { padding: '32px', textAlign: 'center', color: 'var(--halo-text-muted)', fontSize: '13px' },
};
