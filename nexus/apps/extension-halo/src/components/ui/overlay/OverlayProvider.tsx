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
import { Modal, Toasts, Loading, Sheet } from './Overlays';

const OverlayContext = createContext<OverlayContextType | undefined>(undefined);

export const OverlayProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [modal, setModal] = useState<ModalConfig | null>(null);
	const [toasts, setToasts] = useState<(ToastConfig & { id: number })[]>([]);
	const [loading, setLoading] = useState<LoadingConfig | null>(null);
	const [sheet, setSheet] = useState<SheetConfig | null>(null);
	const toastIdRef = useRef(0);

	const showModal = useCallback((config: ModalConfig) => setModal(config), []);
	const closeModal = useCallback(() => setModal(null), []);

	const handleConfirm = async () => {
		if (modal?.onConfirm) await modal.onConfirm();
		closeModal();
	};

	const handleCancel = () => {
		modal?.onCancel?.();
		closeModal();
	};

	const showToast = useCallback((config: ToastConfig) => {
		const id = ++toastIdRef.current;
		setToasts(prev => [...prev, { ...config, id }]);
		setTimeout(() => {
			setToasts(prev => prev.filter(t => t.id !== id));
		}, config.duration || 3000);
	}, []);

	const showLoading = useCallback((config?: LoadingConfig) => setLoading(config || {}), []);
	const hideLoading = useCallback(() => setLoading(null), []);

	const showSheet = useCallback((config: SheetConfig) => setSheet(config), []);
	const closeSheet = useCallback(() => {
		sheet?.onClose?.();
		setSheet(null);
	}, [sheet]);

	return (
		<OverlayContext.Provider value={{ showModal, closeModal, showToast, showLoading, hideLoading, showSheet, closeSheet }}>
			{children}
			{modal && <Modal modal={modal} onConfirm={handleConfirm} onCancel={handleCancel} />}
			<Toasts toasts={toasts} />
			{loading && <Loading loading={loading} />}
			{sheet && <Sheet sheet={sheet} onLocaleClose={closeSheet} />}
			
			<style dangerouslySetInnerHTML={{ __html: `
				@keyframes halo-pop-in { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
				@keyframes halo-slide-up { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
				@keyframes halo-spin { to { transform: rotate(360deg); } }
			`}} />
		</OverlayContext.Provider>
	);
};

export const useOverlay = () => {
	const context = useContext(OverlayContext);
	if (!context) throw new Error('useOverlay must be used within OverlayProvider');
	return context;
};
