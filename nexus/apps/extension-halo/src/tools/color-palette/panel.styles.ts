// goal: Color Palette panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	dropzone: {
		padding: '32px', border: '2px dashed var(--halo-border)', borderRadius: '12px',
		textAlign: 'center', cursor: 'pointer', transition: 'var(--halo-motion-transition, all 0.2s)',
	},
	dropzoneActive: { borderColor: 'var(--halo-accent)', background: 'rgba(99, 102, 241, 0.1)' },
	preview: { maxWidth: '100%', maxHeight: '150px', borderRadius: '8px', objectFit: 'contain' },
	palette: { display: 'flex', flexDirection: 'column', gap: '6px' },
	colorRow: { display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' },
	colorSwatch: {
		width: '48px', height: '48px', borderRadius: '8px', display: 'flex', alignItems: 'center',
		justifyContent: 'center', fontSize: '11px', fontWeight: 600, fontFamily: 'monospace',
	},
	colorInfo: { flex: 1 },
	hex: { fontSize: '13px', fontWeight: 600, color: 'var(--halo-text)', fontFamily: 'monospace' },
	rgb: { fontSize: '11px', color: 'var(--halo-text-muted)' },
	bar: { height: '8px', borderRadius: '4px', background: 'var(--halo-bg-tertiary)', overflow: 'hidden', marginTop: '4px' },
	barFill: { height: '100%', borderRadius: '4px' },
	empty: { color: 'var(--halo-text-muted)', fontSize: '13px' },
};
