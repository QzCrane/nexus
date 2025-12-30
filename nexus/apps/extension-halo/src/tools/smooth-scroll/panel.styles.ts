// goal: Styles for SmoothScrollPanel
// eff: Extracted to separate file

import React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '14px', scrollBehavior: 'smooth' },
	row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' },
	label: { fontSize: '12px', color: 'var(--halo-text)' },
	sublabel: { fontSize: '10px', color: 'var(--halo-text-muted)', marginTop: '2px' },
	select: { padding: '8px 12px', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', borderRadius: '8px', color: 'var(--halo-text)', fontSize: '11px', minWidth: '100px', outline: 'none' },
	input: { width: '70px', padding: '6px 8px', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', borderRadius: '6px', color: 'var(--halo-text)', fontSize: '11px', textAlign: 'center' },
	section: { display: 'flex', flexDirection: 'column', gap: '8px' },
	sectionTitle: { fontSize: '10px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '6px' },
	statusBadge: { padding: '3px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: 600 },
	profileRow: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
	profileBtn: { padding: '6px 12px', background: 'var(--halo-bg-secondary)', border: '1px solid var(--halo-border)', borderRadius: '6px', color: 'var(--halo-text-secondary)', fontSize: '10px', cursor: 'pointer', transition: 'all 0.15s' },
	toast: { position: 'fixed', bottom: '60px', left: '50%', transform: 'translateX(-50%)', padding: '8px 16px', background: 'var(--halo-accent)', borderRadius: '20px', fontSize: '11px', fontWeight: 500, color: '#fff', zIndex: 1000 },
	mgmtRow: { display: 'flex', gap: '8px', marginTop: '4px' },
	mgmtBtn: { flex: 1, padding: '8px', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', borderRadius: '6px', color: 'var(--halo-text-secondary)', fontSize: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', transition: 'all 0.15s' },
	mgmtBtnDanger: { flex: 1, padding: '8px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#ef4444', fontSize: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', transition: 'all 0.15s' },
};
