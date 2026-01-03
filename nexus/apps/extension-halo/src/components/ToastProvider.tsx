import React from 'react';
import { useOverlay } from './ui/overlay';

/**
 * @deprecated Use OverlayProvider in root instead. This component is now a no-op pass-through.
 */
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	return <>{children}</>;
};

export const useToast = () => {
	const { showToast } = useOverlay();
	return {
		showToast: (message: string, duration = 2000) => {
			showToast({ message, duration, type: 'info' });
		}
	};
};
