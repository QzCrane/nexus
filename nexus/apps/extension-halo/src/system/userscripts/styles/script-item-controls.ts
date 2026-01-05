// goal: Control and action styles for ScriptItem
// eff: Buttons, toggles, badges for script cards

import type { CSSProperties } from 'react';

export const controlStyles: Record<string, CSSProperties> = {
	badge: { padding: '2px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: 600 },
	badgeJS: { background: '#F7DF1E', color: '#1a1a1a' }, // JS yellow + dark text
	badgeCSS: { background: '#264de4', color: '#ffffff' }, // CSS blue + white text
	statusDot: { width: '6px', height: '6px', borderRadius: '50%' },
	statusActive: { background: '#4CAF50', boxShadow: '0 0 6px #4CAF50' },
	statusInactive: { background: 'var(--halo-text-muted)' },
	statusLabel: { display: 'flex', alignItems: 'center', gap: '4px' },
	controls: { display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 },
	toggle: {
		width: '38px', height: '22px', borderRadius: '11px',
		background: 'var(--halo-border)', position: 'relative',
		cursor: 'pointer', transition: 'all 0.2s',
	},
	toggleActive: {
		background: 'linear-gradient(135deg, #4CAF50, #45a049)',
		boxShadow: '0 2px 6px rgba(76, 175, 80, 0.25)',
	},
	toggleKnob: {
		position: 'absolute', top: '3px', width: '16px', height: '16px',
		borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
		boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
	},
	actions: {
		display: 'flex', gap: '6px', marginTop: '12px', paddingTop: '12px',
		borderTop: '1px solid var(--halo-border)',
	},
	btn: {
		flex: 1, padding: '8px 12px', borderRadius: '8px',
		border: '1px solid var(--halo-border)', background: 'var(--halo-bg-tertiary)',
		color: 'var(--halo-text-muted)', fontSize: '12px', fontWeight: 500,
		cursor: 'pointer', transition: 'all 0.15s',
		display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
	},
	btnPrimary: {
		background: 'linear-gradient(135deg, #4CAF50, #45a049)',
		border: 'none', color: '#fff',
	},
	iconBtn: {
		width: '32px', height: '32px', display: 'flex', alignItems: 'center',
		justifyContent: 'center', border: 'none', background: 'transparent',
		color: 'var(--halo-text-muted)', borderRadius: '6px', cursor: 'pointer',
		transition: 'all 0.15s', fontSize: '14px',
	},
	reorderBtn: {
		width: '24px', height: '24px', display: 'flex', alignItems: 'center',
		justifyContent: 'center', border: '1px solid var(--halo-border)',
		background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-muted)',
		borderRadius: '4px', cursor: 'pointer', fontSize: '12px', transition: 'all 0.15s',
	},
	deleteBtn: { color: '#ef4444' },
};
