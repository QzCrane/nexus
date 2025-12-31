// goal: Image Tools panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	dropzone: {
		padding: '32px', textAlign: 'center', border: '2px dashed var(--halo-border)',
		borderRadius: '12px', cursor: 'pointer', transition: 'all 0.2s',
		background: 'var(--halo-bg-secondary)', color: 'var(--halo-text-muted)',
	},
	preview: {
		display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '12px',
		background: 'var(--halo-bg-secondary)', borderRadius: '8px',
	},
	img: { maxWidth: '120px', maxHeight: '120px', borderRadius: '6px', objectFit: 'contain' },
	info: { flex: 1, fontSize: '12px', color: 'var(--halo-text-muted)' },
	row: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
	select: {
		padding: '8px 12px', borderRadius: '6px', fontSize: '12px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', cursor: 'pointer',
	},
	slider: { display: 'flex', alignItems: 'center', gap: '12px' },
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', minWidth: '60px' },
	btn: {
		padding: '10px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none',
	},
	btnSecondary: {
		padding: '8px 12px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer',
		background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)', border: '1px solid var(--halo-border)',
	},
	result: { padding: '12px', background: 'var(--halo-bg-secondary)', borderRadius: '8px', fontSize: '12px' },
	savings: { color: 'var(--halo-success, #22c55e)', fontWeight: 600 },
};
