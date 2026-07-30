import type React from 'react';
import { useCallback } from 'react';
import { useOverlay } from './ui/overlay';

/**
 * @deprecated Use OverlayProvider in root instead. This component is now a no-op pass-through.
 */
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	return <>{children}</>;
};

export const useToast = () => {
	const { showToast: showOverlayToast } = useOverlay();
	const showToast = useCallback((message: string, duration = 2000) => {
		showOverlayToast({ message, duration, type: 'info' });
	}, [showOverlayToast]);

	return {
		showToast,
	};
};
