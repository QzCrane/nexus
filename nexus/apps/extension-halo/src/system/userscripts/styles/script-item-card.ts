// goal: Card and layout styles for ScriptItem
// eff: Base card styling and layout structure

import type { CSSProperties } from 'react';

export const cardStyles: Record<string, CSSProperties> = {
	card: {
		display: 'flex',
		flexDirection: 'column',
		padding: '14px',
		borderRadius: '12px',
		background: 'var(--halo-bg-secondary)',
		border: '1px solid var(--halo-border)',
		transition: 'all 0.2s ease',
		cursor: 'pointer',
		position: 'relative',
		overflow: 'hidden',
	},
	cardActive: {
		borderColor: 'rgba(76, 175, 80, 0.4)',
		background: 'linear-gradient(135deg, rgba(76, 175, 80, 0.08) 0%, var(--halo-bg-secondary) 100%)',
	},
	cardDisabled: {
		opacity: 0.6,
	},
	accentBar: {
		position: 'absolute',
		top: 0,
		left: 0,
		right: 0,
		height: '3px',
	},
	header: {
		display: 'flex',
		justifyContent: 'space-between',
		alignItems: 'flex-start',
		gap: '12px',
	},
	titleRow: {
		display: 'flex',
		alignItems: 'center',
		gap: '10px',
		flex: 1,
		minWidth: 0,
	},
	icon: {
		width: '36px',
		height: '36px',
		borderRadius: '10px',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		fontSize: '18px',
		flexShrink: 0,
	},
	iconJS: {
		background: 'linear-gradient(135deg, #FFD700, #FFA500)',
		boxShadow: '0 2px 8px rgba(255, 165, 0, 0.25)',
	},
	iconCSS: {
		background: 'linear-gradient(135deg, #2196F3, #1976D2)',
		boxShadow: '0 2px 8px rgba(33, 150, 243, 0.25)',
	},
	info: {
		flex: 1,
		minWidth: 0,
		display: 'flex',
		flexDirection: 'column',
		gap: '4px',
	},
	name: {
		fontSize: '14px',
		fontWeight: 600,
		color: 'var(--halo-text)',
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
	},
	meta: {
		display: 'flex',
		alignItems: 'center',
		gap: '8px',
		flexWrap: 'wrap',
		fontSize: '11px',
		color: 'var(--halo-text-muted)',
	},
};
