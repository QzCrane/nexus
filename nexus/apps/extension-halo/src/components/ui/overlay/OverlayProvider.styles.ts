import { ANIMATION_CONSTANTS } from '../../../kernel/core/animations';

export const styles = {
	overlay: {
		position: 'fixed' as const,
		top: 0, left: 0, right: 0, bottom: 0,
		background: 'rgba(0, 0, 0, 0.4)',
		// Upgrade to system standard blur
		backdropFilter: 'blur(8px)',
		zIndex: 9999, // Ensure it's on top of everything
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		padding: '24px',
		// Animation for the overlay fade-in
		animation: `var(--halo-motion-animation, haloFadeIn ${ANIMATION_CONSTANTS.DURATION.FAST}ms ${ANIMATION_CONSTANTS.EASING.DEFAULT})`,
	},
	modalContent: {
		// Glassmorphism upgrade or solid panel based on preference?
		// Modals usually need high contrast, so keep robust background but add premium shadow/border
		background: 'var(--halo-bg-panel, #ffffff)',
		borderRadius: '16px',
		padding: '24px',
		width: '100%',
		maxWidth: '320px',
		boxShadow: '0 20px 40px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)',
		border: '1px solid var(--halo-border, rgba(0,0,0,0.1))',
		// Use SSOT animation for pop-in
		animation: `var(--halo-motion-animation, haloPopIn ${ANIMATION_CONSTANTS.DURATION.DEFAULT}ms ${ANIMATION_CONSTANTS.EASING.BOUNCE})`,
	},
	title: {
		fontSize: '18px',
		fontWeight: 700,
		marginBottom: '8px',
		color: 'var(--halo-text, #202020)',
		letterSpacing: '-0.3px',
	},
	message: {
		fontSize: '14px',
		color: 'var(--halo-text-secondary, #404040)',
		marginBottom: '24px',
		lineHeight: 1.6,
		whiteSpace: 'pre-wrap' as const,
	},
	actions: {
		display: 'flex',
		gap: '12px',
		justifyContent: 'flex-end',
	},
	btn: {
		padding: '10px 18px',
		borderRadius: '10px',
		fontSize: '13px',
		fontWeight: 600,
		cursor: 'pointer',
		border: 'none',
		transition: 'var(--halo-motion-transition, all 0.15s cubic-bezier(0.4, 0, 0.2, 1))',
	},
	btnCancel: {
		background: 'var(--halo-bg-tertiary, #f0f0f0)',
		color: 'var(--halo-text, #333)',
	},
	btnConfirm: {
		background: 'var(--halo-primary, #6366f1)',
		color: 'white',
		boxShadow: '0 4px 12px var(--halo-primary-alpha, rgba(99, 102, 241, 0.3))',
	},
	toastContainer: {
		position: 'fixed' as const,
		bottom: '32px',
		left: '50%',
		transform: 'translateX(-50%)',
		zIndex: 10000,
		display: 'flex',
		flexDirection: 'column' as const,
		gap: '12px',
		pointerEvents: 'none' as const,
	},
	toast: {
		background: 'var(--halo-bg-glass-dark, rgba(20, 20, 20, 0.85))',
		color: 'white',
		padding: '12px 24px',
		borderRadius: '50px', // Pill shape
		fontSize: '13px',
		fontWeight: 500,
		boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
		backdropFilter: 'blur(16px)',
		border: '1px solid rgba(255,255,255,0.1)',
		animation: `var(--halo-motion-animation, haloSlideUp ${ANIMATION_CONSTANTS.DURATION.DEFAULT}ms ${ANIMATION_CONSTANTS.EASING.BOUNCE})`,
		display: 'flex',
		alignItems: 'center',
		gap: '10px',
	}
};
