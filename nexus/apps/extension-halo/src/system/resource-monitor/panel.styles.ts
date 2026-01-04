import type { CSSProperties } from 'react';

export const CATEGORY_STYLES: Record<string, { bg: string; color: string; label: string }> = {
	tool: { bg: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', label: 'TOOL' },
	system: { bg: 'rgba(168, 85, 247, 0.15)', color: '#a855f7', label: 'SYS' },
	script: { bg: 'rgba(34, 197, 94, 0.15)', color: '#22c55e', label: 'SCRIPT' },
	core: { bg: 'rgba(100, 100, 100, 0.15)', color: '#888', label: 'CORE' }
};

export const styles: Record<string, CSSProperties> = {
	container: { padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px', height: '100%', overflowY: 'auto' },
	section: { display: 'flex', flexDirection: 'column', gap: '8px' },
	header: { fontSize: '12px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid var(--halo-border)', paddingBottom: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
	card: { background: 'var(--halo-bg-secondary)', borderRadius: '10px', padding: '10px 12px', border: '1px solid var(--halo-border)', cursor: 'pointer', transition: 'all 0.15s' },
	cardExpanded: { background: 'var(--halo-bg-tertiary)' },
	toolRow: { display: 'flex', alignItems: 'center', gap: '10px' },
	icon: { fontSize: '18px', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--halo-bg-tertiary)', borderRadius: '6px', flexShrink: 0 },
	meta: { display: 'flex', flexDirection: 'column', gap: '1px', flex: 1, minWidth: 0 },
	name: { fontWeight: 600, fontSize: '13px', color: 'var(--halo-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
	mechanisms: { fontSize: '10px', color: 'var(--halo-text-muted)', display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' },
	badge: { fontSize: '9px', padding: '2px 5px', borderRadius: '3px', fontWeight: 600 },
	detail: { marginTop: '8px', padding: '8px', background: 'var(--halo-bg)', borderRadius: '6px', fontSize: '10px', fontFamily: 'monospace', color: 'var(--halo-text-secondary)' },
	detailRow: { display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: '1px solid var(--halo-border)' },
	empty: { padding: '16px', color: 'var(--halo-text-muted)', fontSize: '12px', textAlign: 'center' },
	count: { fontSize: '11px', color: 'var(--halo-accent)' }
};
