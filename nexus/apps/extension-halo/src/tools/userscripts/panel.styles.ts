// goal: UserScripts panel styles - elegant sidebar UI
// eff: Modern dark theme with Tampermonkey-like aesthetics

import type { CSSProperties } from 'react';

const ACCENT = '#4CAF50';
const ACCENT_HOVER = '#66BB6A';
const BG_CARD = 'var(--halo-bg-secondary, #252525)';
const BORDER = 'var(--halo-border, #333)';
const TEXT = 'var(--halo-text, #eaeaea)';
const TEXT_MUTED = 'var(--halo-text-secondary, #888)';
const DANGER = '#f44336';

export const styles: Record<string, CSSProperties> = {
	// Layout - no padding to match smooth-scroll
	wrapper: {
		display: 'flex',
		flexDirection: 'column',
		gap: '14px',
		scrollBehavior: 'smooth',
	},

	// Master toggle card
	masterCard: {
		display: 'flex',
		justifyContent: 'space-between',
		alignItems: 'center',
		padding: '14px 16px',
		borderRadius: '10px',
		background: BG_CARD,
		border: `1px solid ${BORDER}`,
		transition: 'all 0.2s ease',
	},
	masterCardActive: {
		background: 'rgba(76, 175, 80, 0.12)',
		borderColor: 'rgba(76, 175, 80, 0.3)',
	},

	// Section headers
	sectionHeader: {
		display: 'flex',
		justifyContent: 'space-between',
		alignItems: 'center',
		marginTop: '8px',
	},
	sectionTitle: {
		fontSize: '13px',
		fontWeight: 600,
		color: TEXT_MUTED,
		textTransform: 'uppercase' as const,
		letterSpacing: '0.5px',
	},

	// Script list
	scriptList: {
		display: 'flex',
		flexDirection: 'column',
		gap: '8px',
	},

	// Script card
	scriptCard: {
		display: 'flex',
		flexDirection: 'column',
		padding: '12px',
		borderRadius: '8px',
		background: BG_CARD,
		border: `1px solid ${BORDER}`,
		transition: 'all 0.15s ease',
		cursor: 'pointer',
	},
	scriptCardHover: {
		borderColor: ACCENT,
		transform: 'translateX(2px)',
	},
	scriptCardDisabled: {
		opacity: 0.5,
	},

	scriptHeader: {
		display: 'flex',
		justifyContent: 'space-between',
		alignItems: 'flex-start',
		gap: '8px',
	},
	scriptInfo: {
		flex: 1,
		minWidth: 0,
	},
	scriptTitle: {
		fontSize: '14px',
		fontWeight: 600,
		color: TEXT,
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap' as const,
	},
	scriptMeta: {
		fontSize: '11px',
		color: TEXT_MUTED,
		marginTop: '4px',
		display: 'flex',
		alignItems: 'center',
		gap: '8px',
		flexWrap: 'wrap' as const,
	},
	scriptBadge: {
		fontSize: '10px',
		padding: '2px 6px',
		borderRadius: '4px',
		background: 'rgba(255,255,255,0.08)',
		color: TEXT_MUTED,
	},
	scriptBadgeCSS: {
		background: 'rgba(33, 150, 243, 0.15)',
		color: '#64B5F6',
	},

	scriptActions: {
		display: 'flex',
		alignItems: 'center',
		gap: '4px',
		flexShrink: 0,
	},

	// Toggle switch
	toggle: {
		width: '36px',
		height: '20px',
		borderRadius: '10px',
		background: BORDER,
		position: 'relative' as const,
		cursor: 'pointer',
		transition: 'background 0.2s ease',
	},
	toggleActive: {
		background: ACCENT,
	},
	toggleKnob: {
		position: 'absolute' as const,
		top: '2px',
		width: '16px',
		height: '16px',
		borderRadius: '50%',
		background: '#fff',
		transition: 'left 0.2s ease',
		boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
	},

	// Icon buttons
	iconBtn: {
		width: '28px',
		height: '28px',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		border: 'none',
		background: 'transparent',
		color: TEXT_MUTED,
		borderRadius: '6px',
		cursor: 'pointer',
		transition: 'all 0.15s ease',
		fontSize: '14px',
	},
	iconBtnHover: {
		background: 'rgba(255,255,255,0.08)',
		color: TEXT,
	},
	iconBtnDanger: {
		color: DANGER,
	},

	// Primary button
	btn: {
		padding: '10px 16px',
		borderRadius: '8px',
		border: 'none',
		background: ACCENT,
		color: '#fff',
		fontWeight: 600,
		fontSize: '13px',
		cursor: 'pointer',
		transition: 'all 0.15s ease',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		gap: '6px',
	},
	btnSecondary: {
		padding: '8px 12px',
		borderRadius: '6px',
		border: `1px solid ${BORDER}`,
		background: 'transparent',
		color: TEXT_MUTED,
		fontSize: '12px',
		cursor: 'pointer',
		transition: 'all 0.15s ease',
		display: 'flex',
		alignItems: 'center',
		gap: '4px',
	},
	btnDanger: {
		background: DANGER,
		color: '#fff',
	},
	btnGroup: {
		display: 'flex',
		gap: '8px',
		flexWrap: 'wrap' as const,
	},

	// Templates grid
	templatesGrid: {
		display: 'grid',
		gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
		gap: '8px',
		marginTop: '8px',
	},
	templateBtn: {
		padding: '10px 8px',
		borderRadius: '8px',
		border: `1px solid ${BORDER}`,
		background: BG_CARD,
		color: TEXT,
		fontSize: '12px',
		cursor: 'pointer',
		transition: 'all 0.15s ease',
		display: 'flex',
		flexDirection: 'column' as const,
		alignItems: 'center',
		gap: '6px',
	},
	templateIcon: {
		fontSize: '20px',
	},

	// Editor
	editorCard: {
		padding: '16px',
		borderRadius: '10px',
		background: BG_CARD,
		border: `1px solid ${BORDER}`,
		display: 'flex',
		flexDirection: 'column',
		gap: '12px',
	},
	editorRow: {
		display: 'flex',
		gap: '8px',
		flexWrap: 'wrap' as const,
	},
	input: {
		flex: 1,
		padding: '10px 12px',
		borderRadius: '6px',
		border: `1px solid ${BORDER}`,
		background: 'var(--halo-bg, #1a1a1a)',
		color: TEXT,
		fontSize: '13px',
		outline: 'none',
		transition: 'border-color 0.15s ease',
	},
	inputFocus: {
		borderColor: ACCENT,
	},
	select: {
		padding: '10px 12px',
		borderRadius: '6px',
		border: `1px solid ${BORDER}`,
		background: 'var(--halo-bg, #1a1a1a)',
		color: TEXT,
		fontSize: '13px',
		cursor: 'pointer',
		minWidth: '110px',
		maxWidth: '100%',
		flexShrink: 0,
	},
	textarea: {
		width: '100%',
		minHeight: '180px',
		padding: '12px',
		borderRadius: '6px',
		border: `1px solid ${BORDER}`,
		background: 'var(--halo-bg, #1a1a1a)',
		color: TEXT,
		fontSize: '12px',
		fontFamily: 'Monaco, Consolas, monospace',
		lineHeight: 1.5,
		resize: 'vertical' as const,
		outline: 'none',
	},
	label: {
		fontSize: '12px',
		fontWeight: 500,
		color: TEXT_MUTED,
		marginBottom: '4px',
	},

	// Empty state
	emptyState: {
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		justifyContent: 'center',
		padding: '40px 20px',
		color: TEXT_MUTED,
		textAlign: 'center' as const,
	},
	emptyIcon: {
		fontSize: '48px',
		marginBottom: '12px',
		opacity: 0.5,
	},

	// Import/Export modal - inline for sidebar
	modal: {
		padding: '16px',
		borderRadius: '10px',
		background: BG_CARD,
		border: `1px solid ${BORDER}`,
		display: 'flex',
		flexDirection: 'column',
		gap: '12px',
	},
	modalContent: {
		width: '100%',
		display: 'flex',
		flexDirection: 'column',
		gap: '12px',
	},
	modalTitle: {
		fontSize: '14px',
		fontWeight: 600,
		color: TEXT,
		display: 'flex',
		alignItems: 'center',
		gap: '6px',
	},

	// Stats
	stats: {
		display: 'flex',
		gap: '12px',
		fontSize: '11px',
		color: TEXT_MUTED,
	},
	statItem: {
		display: 'flex',
		alignItems: 'center',
		gap: '4px',
	},
};
