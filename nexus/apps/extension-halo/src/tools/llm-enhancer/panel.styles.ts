// goal: Styles for LLMEnhancerPanel
// eff: Aligned with smooth-scroll and hover-zoom panel style

import React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '14px', scrollBehavior: 'smooth' },
	row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' },
	label: { fontSize: '12px', color: 'var(--halo-text)' },
	section: { display: 'flex', flexDirection: 'column', gap: '8px' },
	sectionTitle: {
		fontSize: '10px', fontWeight: 600, color: 'var(--halo-text-muted)',
		textTransform: 'uppercase', letterSpacing: '0.5px',
		display: 'flex', alignItems: 'center', gap: '6px'
	},
	desc: { fontSize: '12px', color: 'var(--halo-text-secondary)', marginTop: '2px' },
	// Header specific
	headerTitle: { fontSize: '15px', fontWeight: 600, color: 'var(--halo-text)' },
	headerDesc: { fontSize: '12px', color: 'var(--halo-text-secondary)', opacity: 0.8 },
	activeDot: { width: '6px', height: '6px', borderRadius: '50%', background: '#4CAF50', boxShadow: '0 0 6px #4CAF50' },
	input: { padding: '6px 10px', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', borderRadius: '6px', width: '100%' },
};
