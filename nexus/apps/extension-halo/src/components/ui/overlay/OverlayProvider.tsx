/**
 * Unified Overlay Provider
 * 
 * ALL overlays in HALO must use this system.
 * Usage: const { showModal, showToast, showLoading, showSheet } = useOverlay();
 * 
 * @rule No inline `position: fixed` overlays allowed outside this system.
 */

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import type { ModalConfig, ToastConfig, LoadingConfig, SheetConfig, OverlayContextType } from './types';
import { useTranslation } from '../../../i18n';

const OverlayContext = createContext<OverlayContextType | undefined>(undefined);

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const styles = {
	// Full-screen overlay backdrop
	overlay: {
		position: 'fixed' as const,
		top: 0, left: 0, right: 0, bottom: 0,
		background: 'rgba(0, 0, 0, 0.4)',
		backdropFilter: 'blur(4px)',
		zIndex: 9999,
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		padding: '24px',
	},
	// Modal card
	modalContent: {
		background: 'var(--halo-bg-panel, #ffffff)',
		borderRadius: '16px',
		padding: '24px',
		width: '100%',
		maxWidth: '320px',
		boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
		border: '1px solid var(--halo-border, rgba(0,0,0,0.1))',
		animation: 'halo-pop-in 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
	},
	title: {
		fontSize: '16px',
		fontWeight: 600,
		marginBottom: '8px',
		color: 'var(--halo-text, #202020)',
	},
	message: {
		fontSize: '14px',
		color: 'var(--halo-text, #404040)',
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
		background: 'var(--halo-bg-secondary, #f0f0f0)',
		color: 'var(--halo-text, #333)',
	},
	btnConfirm: {
		background: 'var(--halo-primary, #6366f1)',
		color: 'white',
	},
	btnDanger: {
		background: '#ef4444',
		color: 'white',
	},
	// Toast container
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
		background: 'rgba(0, 0, 0, 0.85)',
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
		pointerEvents: 'auto' as const,
	},
	// Loading overlay
	loadingOverlay: {
		position: 'fixed' as const,
		top: 0, left: 0, right: 0, bottom: 0,
		background: 'rgba(0, 0, 0, 0.3)',
		backdropFilter: 'blur(2px)',
		zIndex: 10001,
		display: 'flex',
		flexDirection: 'column' as const,
		alignItems: 'center',
		justifyContent: 'center',
		gap: '12px',
	},
	spinner: {
		width: '32px',
		height: '32px',
		border: '3px solid rgba(255,255,255,0.3)',
		borderTopColor: 'white',
		borderRadius: '50%',
		animation: 'halo-spin 0.8s linear infinite',
	},
	// Bottom sheet
	sheetOverlay: {
		position: 'fixed' as const,
		top: 0, left: 0, right: 0, bottom: 0,
		background: 'rgba(0, 0, 0, 0.4)',
		zIndex: 9998,
	},
	sheetContent: {
		position: 'fixed' as const,
		left: 0, right: 0, bottom: 0,
		background: 'var(--halo-bg-panel, #ffffff)',
		borderRadius: '16px 16px 0 0',
		padding: '16px',
		zIndex: 9999,
		animation: 'halo-slide-up 0.3s ease-out',
		maxHeight: '80vh',
		overflowY: 'auto' as const,
	},
	sheetHandle: {
		width: '40px',
		height: '4px',
		background: 'var(--halo-border)',
		borderRadius: '2px',
		margin: '0 auto 12px',
	},
};

// ─────────────────────────────────────────────────────────────────────────────
// Provider Component
// ─────────────────────────────────────────────────────────────────────────────
export const OverlayProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const { t } = useTranslation();
	
	// State for each overlay type
	const [modal, setModal] = useState<ModalConfig | null>(null);
	const [toasts, setToasts] = useState<(ToastConfig & { id: number })[]>([]);
	const [loading, setLoading] = useState<LoadingConfig | null>(null);
	const [sheet, setSheet] = useState<SheetConfig | null>(null);
	
	const toastIdRef = useRef(0);

	// ─────────────────────────────────────────────────────────────────────────
	// Modal API
	// ─────────────────────────────────────────────────────────────────────────
	const showModal = useCallback((config: ModalConfig) => {
		setModal(config);
	}, []);

	const closeModal = useCallback(() => {
		setModal(null);
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

	// ─────────────────────────────────────────────────────────────────────────
	// Toast API
	// ─────────────────────────────────────────────────────────────────────────
	const showToast = useCallback((config: ToastConfig) => {
		const id = ++toastIdRef.current;
		setToasts(prev => [...prev, { ...config, id }]);
		setTimeout(() => {
			setToasts(prev => prev.filter(t => t.id !== id));
		}, config.duration || 3000);
	}, []);

	// ─────────────────────────────────────────────────────────────────────────
	// Loading API
	// ─────────────────────────────────────────────────────────────────────────
	const showLoading = useCallback((config?: LoadingConfig) => {
		setLoading(config || {});
	}, []);

	const hideLoading = useCallback(() => {
		setLoading(null);
	}, []);

	// ─────────────────────────────────────────────────────────────────────────
	// Sheet API
	// ─────────────────────────────────────────────────────────────────────────
	const showSheet = useCallback((config: SheetConfig) => {
		setSheet(config);
	}, []);

	const closeSheet = useCallback(() => {
		sheet?.onClose?.();
		setSheet(null);
	}, [sheet]);

	// ─────────────────────────────────────────────────────────────────────────
	// Render
	// ─────────────────────────────────────────────────────────────────────────
	return (
		<OverlayContext.Provider value={{ showModal, closeModal, showToast, showLoading, hideLoading, showSheet, closeSheet }}>
			{children}
			
			{/* Global Modal Overlay */}
			{modal && (
				<div style={styles.overlay} onClick={handleCancel}>
					<div style={styles.modalContent} onClick={e => e.stopPropagation()}>
						{modal.icon && <div style={{ fontSize: '32px', textAlign: 'center', marginBottom: '12px' }}>{modal.icon}</div>}
						{modal.title && <div style={styles.title}>{modal.title}</div>}
						<div style={styles.message}>{modal.message}</div>
						{modal.content}
						
						{!modal.hideFooter && (
							<div style={styles.actions}>
								<button 
									style={{...styles.btn, ...styles.btnCancel}}
									onClick={handleCancel}
								>
									{modal.cancelText || t('common.cancel')}
								</button>
								{(modal.type === 'confirm' || modal.type === 'danger') && (
									<button 
										style={{...styles.btn, ...(modal.type === 'danger' ? styles.btnDanger : styles.btnConfirm)}}
										onClick={handleConfirm}
									>
										{modal.confirmText || t('common.confirm')}
									</button>
								)}
							</div>
						)}
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
						{toast.type === 'info' && 'ℹ️'}
						{toast.message}
						{toast.action && (
							<button 
								style={{ marginLeft: '8px', background: 'transparent', border: 'none', color: 'var(--halo-accent)', cursor: 'pointer', fontSize: '12px' }}
								onClick={toast.action.onClick}
							>
								{toast.action.label}
							</button>
						)}
					</div>
				))}
			</div>

			{/* Global Loading */}
			{loading && (
				<div style={styles.loadingOverlay}>
					{loading.spinner !== false && <div style={styles.spinner} />}
					{loading.message && <div style={{ color: 'white', fontSize: '14px' }}>{loading.message}</div>}
				</div>
			)}

			{/* Global Bottom Sheet */}
			{sheet && (
				<>
					<div style={styles.sheetOverlay} onClick={closeSheet} />
					<div style={{ ...styles.sheetContent, maxHeight: sheet.height === 'full' ? '90vh' : sheet.height === 'half' ? '50vh' : 'auto' }}>
						<div style={styles.sheetHandle} onClick={closeSheet} />
						{sheet.title && <div style={{ ...styles.title, marginBottom: '16px' }}>{sheet.title}</div>}
						{sheet.content}
					</div>
				</>
			)}

			{/* Global Animations */}
			<style dangerouslySetInnerHTML={{ __html: `
				@keyframes halo-pop-in {
					from { opacity: 0; transform: scale(0.95); }
					to { opacity: 1; transform: scale(1); }
				}
				@keyframes halo-slide-up {
					from { opacity: 0; transform: translateY(20px); }
					to { opacity: 1; transform: translateY(0); }
				}
				@keyframes halo-spin {
					to { transform: rotate(360deg); }
				}
			`}} />
		</OverlayContext.Provider>
	);
};

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────
export const useOverlay = () => {
	const context = useContext(OverlayContext);
	if (!context) throw new Error('useOverlay must be used within OverlayProvider');
	return context;
};
