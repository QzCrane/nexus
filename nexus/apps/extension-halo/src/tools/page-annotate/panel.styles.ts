// goal: Page Annotate panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px', height: '100%', justifyContent: 'center', alignItems: 'center' },
	btn: {
		padding: '16px 24px', borderRadius: '12px', fontSize: '16px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
		width: '100%'
	},
	icon: { fontSize: '32px' },
	desc: { fontSize: '13px', color: 'var(--halo-text-muted)', textAlign: 'center', marginTop: '12px' },
};
