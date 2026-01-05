export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '16px', height: '100%', padding: '0' },
	header: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '0' },
	tabs: {
		display: 'flex', gap: '4px', background: 'var(--halo-bg-secondary)',
		padding: '4px', borderRadius: '10px', width: 'fit-content',
		border: '1px solid var(--halo-glass-border)'
	},
	tab: {
		padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
		cursor: 'pointer', border: 'none', background: 'transparent',
		color: 'var(--halo-text-muted)', transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
	},
	tabActive: {
		background: 'var(--halo-card-bg)',
		color: 'var(--halo-text)',
		boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
		border: '1px solid var(--halo-glass-border)'
	},
	tabUpdate: { color: '#22c55e' },
	list: { display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto', flex: 1, minHeight: 0, padding: '0 0 16px 0' },
	item: {
		display: 'flex', alignItems: 'center', gap: '16px', padding: '14px 18px',
		// Premium Glassmorphism
		background: 'var(--halo-card-bg)',
		borderRadius: '16px',
		border: '1px solid var(--halo-glass-border)',
		backdropFilter: 'blur(12px)',
		boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.02), 0 2px 4px -1px rgba(0, 0, 0, 0.02)',
		transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
		cursor: 'default',
	},
	icon: {
		fontSize: '24px', minWidth: '44px', textAlign: 'center',
		background: 'var(--halo-bg-tertiary)',
		borderRadius: '12px', padding: '10px', height: '44px',
		display: 'flex', alignItems: 'center', justifyContent: 'center',
		color: 'var(--halo-text)',
		border: '1px solid var(--halo-glass-border)',
	},
	info: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' },
	name: { fontSize: '14px', fontWeight: 700, color: 'var(--halo-text)', display: 'flex', alignItems: 'center', gap: '8px', letterSpacing: '-0.2px' },
	desc: { fontSize: '12px', color: 'var(--halo-text-secondary)', lineHeight: '1.4', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' },
	btn: {
		padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
		cursor: 'pointer', border: '1px solid transparent', transition: 'all 0.2s ease', minWidth: '80px',
	},
	btnInstall: {
		background: 'var(--halo-accent)', color: '#fff',
		boxShadow: '0 2px 8px var(--halo-primary-alpha, rgba(99, 102, 241, 0.25))'
	},
	btnRefresh: {
		padding: '8px', borderRadius: '10px', fontSize: '16px', cursor: 'pointer',
		border: '1px solid var(--halo-glass-border)', background: 'var(--halo-bg-secondary)',
		color: 'var(--halo-text)', width: '38px', height: '38px',
		display: 'flex', alignItems: 'center', justifyContent: 'center',
		transition: 'all 0.2s ease',
	},
	badge: { fontSize: '10px', padding: '2px 8px', borderRadius: '20px', fontWeight: 600, border: '1px solid rgba(0,0,0,0.05)' },
	badgeUpdate: { background: 'rgba(34, 197, 94, 0.15)', color: '#16a34a' },
	empty: { padding: '48px', textAlign: 'center', color: 'var(--halo-text-muted)', fontSize: '14px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' },
	stats: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', letterSpacing: '0.5px' },
};
