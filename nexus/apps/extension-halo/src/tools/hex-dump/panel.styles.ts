// goal: Hex Dump panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px', height: '100%', overflow: 'hidden' },
	dropzone: {
		padding: '24px', border: '2px dashed var(--halo-border)', borderRadius: '12px',
		textAlign: 'center', cursor: 'pointer', flexShrink: 0,
	},
	loading: { textAlign: 'center', padding: '20px', color: 'var(--halo-text-muted)' },
	viewer: {
		flex: 1, overflow: 'auto', fontFamily: 'monospace', fontSize: '12px',
		background: 'var(--halo-bg-tertiary)', borderRadius: '8px', padding: '12px',
		whiteSpace: 'pre', color: 'var(--halo-text)',
	},
	line: { display: 'flex', gap: '16px' },
	offset: { color: 'var(--halo-accent)', userSelect: 'none' },
	hex: { color: 'var(--halo-text)' },
	ascii: { color: 'var(--halo-text-muted)', borderLeft: '1px solid var(--halo-border)', paddingLeft: '16px' },
};
