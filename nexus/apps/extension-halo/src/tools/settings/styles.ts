// goal: Settings panel styles
// eff: Styles for settings sections, rows, theme grid, color swatches

import type React from 'react';

export const settingsStyles: Record<string, React.CSSProperties> = {
	wrapper: {
		display: 'flex',
		flexDirection: 'column',
		gap: '16px',
	},
	section: {
		display: 'flex',
		flexDirection: 'column',
		gap: '12px',
	},
	sectionTitle: {
		fontSize: '11px',
		fontWeight: 600,
		color: 'var(--halo-text-muted)',
		textTransform: 'uppercase',
		letterSpacing: '0.5px',
	},
	row: {
		display: 'flex',
		justifyContent: 'space-between',
		alignItems: 'center',
		padding: '8px 0',
	},
	label: {
		fontSize: '13px',
		color: 'var(--halo-text)',
	},
	sublabel: {
		fontSize: '11px',
		color: 'var(--halo-text-muted)',
		marginTop: '2px',
	},
	themeGrid: {
		display: 'grid',
		gridTemplateColumns: 'repeat(3, 1fr)',
		gap: '8px',
	},
	themeBtn: {
		padding: '12px 8px',
		border: '2px solid var(--halo-border)',
		borderRadius: '8px',
		background: 'var(--halo-bg-secondary)',
		color: 'var(--halo-text)',
		fontSize: '12px',
		cursor: 'pointer',
		transition: 'all 0.15s',
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		gap: '4px',
	},
	themeBtnActive: {
		borderColor: 'var(--halo-accent)',
		background: 'var(--halo-bg-tertiary)',
	},
	colorGrid: {
		display: 'flex',
		gap: '8px',
		flexWrap: 'wrap',
	},
	colorSwatch: {
		width: '32px',
		height: '32px',
		borderRadius: '8px',
		cursor: 'pointer',
		border: '2px solid transparent',
		transition: 'transform 0.1s, border-color 0.15s',
	},
	colorSwatchActive: {
		borderColor: 'var(--halo-text)',
		transform: 'scale(1.1)',
	},
	select: {
		padding: '8px 12px',
		background: 'var(--halo-bg-tertiary)',
		border: '1px solid var(--halo-border)',
		borderRadius: '6px',
		color: 'var(--halo-text)',
		fontSize: '12px',
		minWidth: '120px',
	},
	resetBtn: {
		padding: '10px 16px',
		background: 'transparent',
		border: '1px solid var(--halo-border)',
		borderRadius: '6px',
		color: 'var(--halo-text-secondary)',
		fontSize: '12px',
		cursor: 'pointer',
		transition: 'background 0.15s',
	},
	version: {
		fontSize: '11px',
		color: 'var(--halo-text-muted)',
		textAlign: 'center',
		padding: '12px 0',
	},
	toast: {
		position: 'fixed',
		bottom: '20px',
		left: '50%',
		transform: 'translateX(-50%)',
		padding: '8px 16px',
		background: 'var(--halo-success)',
		borderRadius: '6px',
		fontSize: '12px',
		color: '#fff',
		zIndex: 1000,
	},
};
