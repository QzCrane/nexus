// goal: Styles for HoverZoomPanel
// eff: Aligned with smooth-scroll panel style

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '14px', scrollBehavior: 'smooth' },
	row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' },
	label: { fontSize: '12px', color: 'var(--halo-text)' },
	section: { display: 'flex', flexDirection: 'column', gap: '8px' },
	sectionTitle: { fontSize: '10px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '6px' },
	value: { fontSize: '11px', color: 'var(--halo-text-secondary)', fontFamily: 'monospace' },
	segmented: { display: 'flex', gap: '4px', background: 'var(--halo-bg-tertiary)', padding: '3px', borderRadius: '8px' },
	segmentBtn: { padding: '5px 10px', border: 'none', background: 'transparent', color: 'var(--halo-text-secondary)', fontSize: '11px', cursor: 'pointer', borderRadius: '6px', transition: 'var(--halo-motion-transition, all 0.15s)' },
	segmentBtnActive: { padding: '5px 10px', border: 'none', background: 'var(--halo-accent)', color: '#fff', fontSize: '11px', cursor: 'pointer', borderRadius: '6px', fontWeight: 500 },
	select: { padding: '6px 10px', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', borderRadius: '6px', color: 'var(--halo-text)', fontSize: '11px', outline: 'none', cursor: 'pointer' },
	hotkeyList: { fontSize: '11px', color: 'var(--halo-text-secondary)', lineHeight: 1.8, display: 'flex', flexDirection: 'column', gap: '2px' },
	hotkeyItem: { display: 'flex', gap: '8px', alignItems: 'center' },
	hotkeyKey: { background: 'var(--halo-bg-tertiary)', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontFamily: 'monospace', fontWeight: 500 },
};
