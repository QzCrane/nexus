export interface ModalConfig {
	title?: string;
	message: string; // Or content node
	type?: 'alert' | 'confirm' | 'info';
	confirmText?: string;
	cancelText?: string;
	onConfirm?: () => void | Promise<void>;
	onCancel?: () => void;
	// Component override for complex content
	content?: React.ReactNode;
}

export interface ToastConfig {
	message: string;
	type?: 'success' | 'error' | 'info' | 'warning';
	duration?: number;
}

export interface OverlayContextType {
	showModal: (config: ModalConfig) => void;
	closeModal: () => void;
	showToast: (config: ToastConfig) => void;
}
