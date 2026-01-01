// goal: Protobuf panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' },
	textarea: {
		width: '100%', minHeight: '80px', padding: '12px', borderRadius: '8px', fontSize: '13px',
		fontFamily: 'monospace', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)',
		color: 'var(--halo-text)', resize: 'vertical',
	},
	viewer: {
		flex: 1, overflow: 'auto', background: 'var(--halo-bg-secondary)', borderRadius: '8px', padding: '12px',
		fontFamily: 'monospace', fontSize: '12px',
	},
	node: { marginLeft: '16px', borderLeft: '1px solid var(--halo-border)', paddingLeft: '8px', marginTop: '4px' },
	field: { color: 'var(--halo-accent)', fontWeight: 600 },
	type: { color: 'var(--halo-text-muted)', fontSize: '10px', marginLeft: '6px' },
	value: { color: 'var(--halo-text)', marginLeft: '6px' },
};
