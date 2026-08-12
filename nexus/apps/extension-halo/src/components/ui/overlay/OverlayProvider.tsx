import type React from 'react';
import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import type { ModalConfig, ToastConfig, OverlayContextType } from './types';
import { useTranslation } from '../../../i18n';
import { styles } from './OverlayProvider.styles';

const OverlayContext = createContext<OverlayContextType | undefined>(undefined);
const MAX_TOASTS = 4;

export const OverlayProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const { t } = useTranslation();
	const [modal, setModal] = useState<ModalConfig | null>(null);
	const [toasts, setToasts] = useState<(ToastConfig & { id: number })[]>([]);
	const toastIdRef = useRef(0);
	const toastTimersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());

	useEffect(() => () => {
		for (const timer of toastTimersRef.current.values()) clearTimeout(timer);
		toastTimersRef.current.clear();
	}, []);

	const showModal = useCallback((config: ModalConfig) => {
		setModal(config);
	}, []);

	const closeModal = useCallback(() => {
		setModal(null);
	}, []);

	const showToast = useCallback((config: ToastConfig) => {
		const id = ++toastIdRef.current;
		const timer = setTimeout(() => {
			toastTimersRef.current.delete(id);
			setToasts(prev => prev.filter(t => t.id !== id));
		}, config.duration ?? 3000);
		toastTimersRef.current.set(id, timer);
		setToasts(prev => {
			const next = [...prev, { ...config, id }];
			for (const evicted of next.slice(0, -MAX_TOASTS)) {
				const evictedTimer = toastTimersRef.current.get(evicted.id);
				if (evictedTimer) clearTimeout(evictedTimer);
				toastTimersRef.current.delete(evicted.id);
			}
			return next.slice(-MAX_TOASTS);
		});
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
			{/* Global Animation Definitions */}
			<style>{`
				@keyframes haloFadeIn { from { opacity: 0; } to { opacity: 1; } }
				@keyframes haloPopIn { 
					from { opacity: 0; transform: scale(0.95) translateY(10px); } 
					to { opacity: 1; transform: scale(1) translateY(0); } 
				}
				@keyframes haloSlideUp { 
					from { opacity: 0; transform: translateY(20px) scale(0.95); } 
					to { opacity: 1; transform: translateY(0) scale(1); } 
				}
			`}</style>

			{children}
			
			{/* Global Modal Overlay */}
			{modal && (
				<div style={styles.overlay}>
					<button
						type="button"
						aria-label={modal.cancelText || t('common.cancel')}
						onClick={handleCancel}
						style={{ position: 'absolute', inset: 0, border: 0, padding: 0, background: 'transparent' }}
					/>
					<div style={{ ...styles.modalContent, position: 'relative' }} role="dialog" aria-modal="true">
						{modal.title && <div style={styles.title}>{modal.title}</div>}
						<div style={styles.message}>{modal.message}</div>
						{/* If custom content provided, render it */}
						{modal.content}
						
						{!modal.hideFooter && (
							<div style={styles.actions}>
								<button type="button"
									style={{...styles.btn, ...styles.btnCancel}}
									onClick={handleCancel}
								>
									{modal.cancelText || t('common.cancel')}
								</button>
								{modal.type === 'confirm' && (
									<button type="button"
										style={{...styles.btn, ...styles.btnConfirm}}
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
