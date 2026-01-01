// goal: Tab Group panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' },
	permission: { padding: '20px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' },
	permBtn: { padding: '8px 16px', background: 'var(--halo-accent)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' },

	header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
	createBtn: { padding: '6px 12px', background: 'var(--halo-accent)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 },

	list: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' },
	card: { padding: '10px', borderRadius: '8px', background: 'var(--halo-bg-secondary)', border: '1px solid var(--halo-border)' },

	groupHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' },
	groupTitle: { fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' },
	dot: { width: '10px', height: '10px', borderRadius: '50%' },

	controls: { display: 'flex', gap: '8px' },
	iconBtn: { background: 'transparent', border: 'none', cursor: 'pointer', opacity: 0.7, fontSize: '14px' },

	tabs: { paddingLeft: '16px', fontSize: '11px', color: 'var(--halo-text-muted)', display: 'flex', flexDirection: 'column', gap: '4px' },

	createForm: { padding: '12px', background: 'var(--halo-bg-tertiary)', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '8px' },
	input: { padding: '8px', borderRadius: '4px', border: '1px solid var(--halo-border)', background: 'var(--halo-bg-secondary)', color: 'var(--halo-text)' },
	colors: { display: 'flex', gap: '6px' },
	colorOption: { width: '16px', height: '16px', borderRadius: '50%', cursor: 'pointer', border: '2px solid transparent' }
};
