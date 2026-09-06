// goal: EXIF Reader panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	dropzone: {
		padding: '32px', border: '2px dashed var(--halo-border)', borderRadius: '12px',
		textAlign: 'center', cursor: 'pointer', transition: 'var(--halo-motion-transition, all 0.2s)',
	},
	dropzoneActive: { borderColor: 'var(--halo-accent)', background: 'rgba(99, 102, 241, 0.1)' },
	preview: { maxWidth: '100%', maxHeight: '150px', borderRadius: '8px', objectFit: 'contain' },
	grid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' },
	item: {
		padding: '10px', background: 'var(--halo-bg-secondary)', borderRadius: '8px',
		display: 'flex', flexDirection: 'column', gap: '2px',
	},
	label: { fontSize: '10px', color: 'var(--halo-text-muted)', textTransform: 'uppercase', fontWeight: 600 },
	value: { fontSize: '13px', color: 'var(--halo-text)', fontWeight: 500 },
	empty: { color: 'var(--halo-text-muted)', fontSize: '13px' },
	btn: {
		padding: '8px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none',
	},
};
