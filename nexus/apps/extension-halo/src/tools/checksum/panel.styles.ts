// goal: Checksum panel styles

import type React from 'react';

export const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	dropzone: {
		padding: '32px', border: '2px dashed var(--halo-border)', borderRadius: '12px',
		textAlign: 'center', cursor: 'pointer',
	},
	file: { padding: '12px', background: 'var(--halo-bg-secondary)', borderRadius: '8px' },
	fileName: { fontSize: '13px', fontWeight: 600, color: 'var(--halo-text)' },
	fileSize: { fontSize: '11px', color: 'var(--halo-text-muted)' },
	row: { display: 'flex', gap: '8px', alignItems: 'center' },
	select: {
		padding: '8px 12px', borderRadius: '6px', fontSize: '12px',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', color: 'var(--halo-text)',
	},
	hash: {
		width: '100%', padding: '12px', borderRadius: '8px', fontSize: '11px', fontFamily: 'monospace',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', color: 'var(--halo-text)',
		wordBreak: 'break-all',
	},
	input: {
		flex: 1, padding: '10px', borderRadius: '6px', fontSize: '11px', fontFamily: 'monospace',
		background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', color: 'var(--halo-text)',
	},
	btn: {
		padding: '10px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
		background: 'var(--halo-accent)', color: '#fff', border: 'none',
	},
	match: { padding: '8px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600 },
	matchOk: { background: 'rgba(34, 197, 94, 0.1)', color: '#22c55e' },
	matchFail: { background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' },
};
