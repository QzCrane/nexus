// goal: Styles for QRCodePanel

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	tabs: { display: 'flex', gap: '4px', background: 'var(--halo-bg-secondary)', borderRadius: '10px', padding: '4px' },
	tab: { flex: 1, padding: '10px', border: 'none', borderRadius: '8px', background: 'transparent', color: 'var(--halo-text-secondary)', fontSize: '12px', fontWeight: 500, cursor: 'pointer', transition: 'var(--halo-motion-transition, all 0.15s)' },
	tabActive: { background: 'var(--halo-accent)', color: '#fff' },
	textarea: { width: '100%', minHeight: '60px', padding: '12px', border: '1px solid var(--halo-border)', borderRadius: '10px', background: 'var(--halo-bg-secondary)', color: 'var(--halo-text)', fontSize: '13px', resize: 'vertical', fontFamily: 'inherit', outline: 'none' },
	optionsRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '10px' },
	option: { display: 'flex', flexDirection: 'column', gap: '4px' },
	label: { fontSize: '10px', color: 'var(--halo-text-muted)', textTransform: 'uppercase' },
	colorInput: { width: '100%', height: '30px', border: '1px solid var(--halo-border)', borderRadius: '6px', cursor: 'pointer', background: 'transparent', padding: 0 },
	logoInput: { display: 'none' },
	logoBtn: { padding: '6px', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', borderRadius: '6px', fontSize: '11px', color: 'var(--halo-text-secondary)', cursor: 'pointer', textAlign: 'center' },
	btn: { padding: '12px 18px', background: 'linear-gradient(135deg, var(--halo-accent), #4a9eff)', border: 'none', borderRadius: '10px', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' },
	btnSecondary: { background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', color: 'var(--halo-text-secondary)', fontWeight: 500 },
	qrContainer: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', padding: '20px', background: 'var(--halo-bg-secondary)', borderRadius: '12px' },
	qrImage: { padding: '14px', background: 'var(--white, #fff)', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' },
	actionRow: { display: 'flex', gap: '10px', width: '100%' },
	actionBtn: { flex: 1, padding: '10px', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', borderRadius: '10px', color: 'var(--halo-text-secondary)', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' },
	historySection: { marginTop: '8px' },
	historyTitle: { fontSize: '11px', color: 'var(--halo-text-muted)', marginBottom: '8px', display: 'flex', justifyContent: 'space-between' },
	historyList: { display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '100px', overflowY: 'auto', paddingRight: '4px' },
	historyItem: { padding: '8px 12px', background: 'var(--halo-bg-secondary)', borderRadius: '8px', fontSize: '11px', color: 'var(--halo-text-secondary)', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: '1px solid transparent' },
	scanZone: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '40px 20px', background: 'var(--halo-bg-secondary)', borderRadius: '12px', border: '2px dashed var(--halo-border)', textAlign: 'center', cursor: 'pointer' },
	scanIcon: { fontSize: '48px', opacity: 0.5 },
	scanBtns: { display: 'flex', gap: '10px' },
	resultCard: { padding: '16px', background: 'var(--halo-bg-secondary)', borderRadius: '12px', border: '1px solid var(--halo-accent)' },
	resultLabel: { fontSize: '10px', color: 'var(--halo-text-muted)', marginBottom: '8px', textTransform: 'uppercase' },
	resultText: { fontSize: '13px', color: 'var(--halo-text)', wordBreak: 'break-all', lineHeight: 1.5 },
	toast: { position: 'fixed', bottom: '60px', left: '50%', transform: 'translateX(-50%)', padding: '10px 20px', background: 'var(--halo-accent)', borderRadius: '24px', fontSize: '12px', fontWeight: 500, color: '#fff', zIndex: 1000 },
};
