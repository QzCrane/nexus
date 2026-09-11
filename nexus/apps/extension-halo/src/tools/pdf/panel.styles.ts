// goal: Styles for PDFPanel
// eff: Extracted to separate file

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	dropZone: { padding: '32px 20px', border: '2px dashed var(--halo-border)', borderRadius: '12px', textAlign: 'center', color: 'var(--halo-text-muted)', fontSize: '13px', cursor: 'pointer', transition: 'var(--halo-motion-transition, all 0.2s)', background: 'var(--halo-bg-tertiary)' },
	dropZoneActive: { borderColor: 'var(--halo-accent)', background: 'rgba(124, 58, 237, 0.1)' },
	fileList: { display: 'flex', flexDirection: 'column', gap: '8px' },
	fileItem: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--halo-bg-tertiary)', borderRadius: '8px', border: '1px solid var(--halo-border)' },
	opGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' },
	opBtn: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', padding: '12px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 500, cursor: 'pointer', transition: 'var(--halo-motion-transition, all 0.15s)', border: '1px solid var(--halo-border)', background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)' },
	opActive: { background: 'var(--halo-accent)', borderColor: 'var(--halo-accent)', color: '#fff' },
	actionBtn: { width: '100%', padding: '12px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', border: 'none', background: 'var(--halo-accent)', color: '#fff', transition: 'var(--halo-motion-transition, all 0.15s)' },
	label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase' },
};
