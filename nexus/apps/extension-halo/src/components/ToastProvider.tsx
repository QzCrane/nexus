import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

interface ToastContextType {
	showToast: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [message, setMessage] = useState<string | null>(null);
	const timerRef = useRef<NodeJS.Timeout | null>(null);

	const showToast = useCallback((msg: string, duration = 2000) => {
		if (timerRef.current) clearTimeout(timerRef.current);
		setMessage(msg);
		timerRef.current = setTimeout(() => {
			setMessage(null);
			timerRef.current = null;
		}, duration);
	}, []);

	return (
		<ToastContext.Provider value={{ showToast }}>
			{children}
			{message && (
				<div style={{
					position: 'fixed',
					bottom: '60px',
					left: '50%',
					transform: 'translateX(-50%)',
					padding: '8px 16px',
					background: 'var(--halo-accent)',
					borderRadius: '20px',
					fontSize: '11px',
					fontWeight: 500,
					color: '#fff',
					zIndex: 9999,
					boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
					pointerEvents: 'none',
					whiteSpace: 'nowrap'
				}}>
					{message}
				</div>
			)}
		</ToastContext.Provider>
	);
};

export const useToast = () => {
	const context = useContext(ToastContext);
	if (!context) {
		throw new Error('useToast must be used within a ToastProvider');
	}
	return context;
};
