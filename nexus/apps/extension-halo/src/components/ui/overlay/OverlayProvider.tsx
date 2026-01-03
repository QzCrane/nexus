import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { ModalConfig, ToastConfig, OverlayContextType } from './types';
import { useTranslation } from '../../../i18n';

const OverlayContext = createContext<OverlayContextType | undefined>(undefined);

const styles = {
	overlay: {
		position: 'fixed' as const,
		top: 0, left: 0, right: 0, bottom: 0,
		background: 'rgba(0, 0, 0, 0.4)',
		backdropFilter: 'blur(4px)',
		zIndex: 9999, // Ensure it's on top of everything
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		padding: '24px',
		// Reset any potential transforms from parents if rendered in portal (but here we wrapping root)
	},
	modalContent: {
		background: 'var(--halo-bg-primary)',
		borderRadius: '16px',
		padding: '24px',
		width: '100%',
		maxWidth: '320px',
		boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
		border: '1px solid var(--halo-border)',
		animation: 'halo-pop-in 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
	},
	title: {
		fontSize: '16px',
		fontWeight: 600,
		marginBottom: '8px',
		color: 'var(--halo-text)',
	},
	message: {
		fontSize: '14px',
		color: 'var(--halo-text-muted)',
		marginBottom: '20px',
		lineHeight: 1.5,
		whiteSpace: 'pre-wrap' as const,
	},
	actions: {
		display: 'flex',
		gap: '12px',
		justifyContent: 'flex-end',
	},
	btn: {
		padding: '8px 16px',
		borderRadius: '8px',
		fontSize: '13px',
		fontWeight: 500,
		cursor: 'pointer',
		border: 'none',
		transition: 'all 0.2s',
	},
	btnCancel: {
		background: 'var(--halo-bg-secondary)',
		color: 'var(--halo-text)',
	},
	btnConfirm: {
		background: 'var(--halo-primary)',
		color: 'white',
	},
	toastContainer: {
		position: 'fixed' as const,
		bottom: '24px',
		left: '50%',
		transform: 'translateX(-50%)',
		zIndex: 10000,
		display: 'flex',
		flexDirection: 'column' as const,
		gap: '8px',
		pointerEvents: 'none' as const,
	},
	toast: {
		background: 'rgba(0, 0, 0, 0.8)',
		color: 'white',
		padding: '10px 20px',
		borderRadius: '20px',
		fontSize: '13px',
		boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
		backdropFilter: 'blur(8px)',
		animation: 'halo-slide-up 0.3s ease-out',
		display: 'flex',
		alignItems: 'center',
		gap: '8px',
	}
};

export const OverlayProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const { t } = useTranslation();
	const [modal, setModal] = useState<ModalConfig | null>(null);
	const [toasts, setToasts] = useState<(ToastConfig & { id: number })[]>([]);
	const toastIdRef = useRef(0);

	const showModal = useCallback((config: ModalConfig) => {
		setModal(config);
	}, []);

	const closeModal = useCallback(() => {
		setModal(null);
	}, []);

	const showToast = useCallback((config: ToastConfig) => {
		const id = ++toastIdRef.current;
		setToasts(prev => [...prev, { ...config, id }]);
		setTimeout(() => {
			setToasts(prev => prev.filter(t => t.id !== id));
		}, config.duration || 3000);
	}, []);

	const handleConfirm = async () => {
		if (modal?.onConfirm) {
			await modal.onConfirm();
		}
		closeModal();
	};

	const handleCancel = () => {
		modal?.onCancel?.();
		closeModal();
	};

	return (
		<OverlayContext.Provider value={{ showModal, closeModal, showToast }}>
			{children}
			
			{/* Global Modal Overlay */}
			{modal && (
				<div style={styles.overlay} onClick={handleCancel}>
					<div style={styles.modalContent} onClick={e => e.stopPropagation()}>
						{modal.title && <div style={styles.title}>{modal.title}</div>}
						<div style={styles.message}>{modal.message}</div>
						{/* If custom content provided, render it */}
						{modal.content}
						
						<div style={styles.actions}>
							<button 
								style={{...styles.btn, ...styles.btnCancel}}
								onClick={handleCancel}
							>
								{modal.cancelText || t('common.cancel')}
							</button>
							{modal.type === 'confirm' && (
								<button 
									style={{...styles.btn, ...styles.btnConfirm}}
									onClick={handleConfirm}
								>
									{modal.confirmText || t('common.confirm')}
								</button>
							)}
						</div>
					</div>
				</div>
			)}

			{/* Global Toasts */}
			<div style={styles.toastContainer}>
				{toasts.map(toast => (
					<div key={toast.id} style={styles.toast}>
						{toast.type === 'success' && '✅'}
						{toast.type === 'error' && '❌'}
						{toast.type === 'warning' && '⚠️'}
						{toast.message}
					</div>
				))}
			</div>
		</OverlayContext.Provider>
	);
};

export const useOverlay = () => {
	const context = useContext(OverlayContext);
	if (!context) throw new Error('useOverlay must be used within OverlayProvider');
	return context;
};
