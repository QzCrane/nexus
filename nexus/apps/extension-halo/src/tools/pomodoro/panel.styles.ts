// goal: Pomodoro panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' },
	timer: { position: 'relative', width: '200px', height: '200px' },
	circle: { transform: 'rotate(-90deg)' },
	time: {
		position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
		fontSize: '42px', fontWeight: 700, fontFamily: 'monospace', color: 'var(--halo-text)',
	},
	phase: { fontSize: '16px', fontWeight: 600 },
	sessions: { fontSize: '12px', color: 'var(--halo-text-muted)' },
	controls: { display: 'flex', gap: '12px' },
	btn: {
		padding: '14px 28px', borderRadius: '12px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none',
	},
	btnSecondary: {
		padding: '12px 20px', borderRadius: '8px', fontSize: '12px', cursor: 'pointer',
		background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text)', border: '1px solid var(--halo-border)',
	},
	config: { display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center' },
	configItem: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' },
	input: {
		width: '60px', padding: '8px', textAlign: 'center', borderRadius: '6px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', fontSize: '14px', fontWeight: 600,
	},
	label: { fontSize: '10px', color: 'var(--halo-text-muted)' },
};
