/**
 * Unified Overlay System Types
 * 
 * ALL overlays in HALO must use this system. DO NOT create inline fixed overlays.
 * 
 * Supported types:
 * - Modal: Confirm/Alert dialogs with optional custom content
 * - Toast: Transient notifications (success/error/warning/info)
 * - Sheet: Bottom sheet for mobile-like interactions
 * - Tooltip: Contextual hints (manual control)
 * - Loading: Full-screen loading indicator
 */

// ─────────────────────────────────────────────────────────────────────────────
// Modal Configuration
// ─────────────────────────────────────────────────────────────────────────────
export interface ModalConfig {
	/** Modal title (optional, shows as header) */
	title?: string;
	/** Main message text (required unless content is provided) */
	message: string;
	/** Modal type determines button layout */
	type?: 'alert' | 'confirm' | 'info' | 'danger';
	/** Custom confirm button text */
	confirmText?: string;
	/** Custom cancel button text */
	cancelText?: string;
	/** Callback when confirm is clicked */
	onConfirm?: () => void | Promise<void>;
	/** Callback when cancel/close is clicked */
	onCancel?: () => void;
	/** Custom React content to render inside modal body */
	content?: React.ReactNode;
	/** Hide footer buttons (for fully custom content) */
	hideFooter?: boolean;
	/** Icon override (emoji or React node) */
	icon?: React.ReactNode;
}

// ─────────────────────────────────────────────────────────────────────────────
// Toast Configuration
// ─────────────────────────────────────────────────────────────────────────────
export interface ToastConfig {
	/** Toast message */
	message: string;
	/** Toast type determines icon and color */
	type?: 'success' | 'error' | 'info' | 'warning';
	/** Duration in ms (default: 3000) */
	duration?: number;
	/** Optional action button */
	action?: {
		label: string;
		onClick: () => void;
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading Configuration
// ─────────────────────────────────────────────────────────────────────────────
export interface LoadingConfig {
	/** Loading message (optional) */
	message?: string;
	/** Show spinner (default: true) */
	spinner?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sheet Configuration (Bottom Sheet)
// ─────────────────────────────────────────────────────────────────────────────
export interface SheetConfig {
	/** Sheet title */
	title?: string;
	/** Custom content */
	content: React.ReactNode;
	/** Close callback */
	onClose?: () => void;
	/** Height: 'auto' | 'half' | 'full' */
	height?: 'auto' | 'half' | 'full';
}

// ─────────────────────────────────────────────────────────────────────────────
// Context API
// ─────────────────────────────────────────────────────────────────────────────
export interface OverlayContextType {
	// Modal
	showModal: (config: ModalConfig) => void;
	closeModal: () => void;

	// Toast
	showToast: (config: ToastConfig) => void;

	// Loading
	showLoading: (config?: LoadingConfig) => void;
	hideLoading: () => void;

	// Sheet
	showSheet: (config: SheetConfig) => void;
	closeSheet: () => void;
}
