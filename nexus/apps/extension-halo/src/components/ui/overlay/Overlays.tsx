import React from 'react';
import { styles } from './OverlayProvider.styles';
import type { ModalConfig, ToastConfig, LoadingConfig, SheetConfig } from './types';
import { useTranslation } from '../../../i18n';

export const Modal: React.FC<{ modal: ModalConfig; onConfirm: () => void; onCancel: () => void }> = ({ modal, onConfirm, onCancel }) => {
	const { t } = useTranslation();
	return (
		<div style={styles.overlay} onClick={onCancel}>
			<div style={styles.modalContent} onClick={e => e.stopPropagation()}>
				{modal.icon && <div style={{ fontSize: '32px', textAlign: 'center', marginBottom: '12px' }}>{modal.icon}</div>}
				{modal.title && <div style={styles.title}>{modal.title}</div>}
				<div style={styles.message}>{modal.message}</div>
				{modal.content}
				{!modal.hideFooter && (
					<div style={styles.actions}>
						<button style={{ ...styles.btn, ...styles.btnCancel }} onClick={onCancel}>
							{modal.cancelText || t('common.cancel')}
						</button>
						{(modal.type === 'confirm' || modal.type === 'danger') && (
							<button 
								style={{ ...styles.btn, ...(modal.type === 'danger' ? styles.btnDanger : styles.btnConfirm) }} 
								onClick={onConfirm}
							>
								{modal.confirmText || t('common.confirm')}
							</button>
						)}
					</div>
				)}
			</div>
		</div>
	);
};

export const Toasts: React.FC<{ toasts: (ToastConfig & { id: number })[] }> = ({ toasts }) => (
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
);

export const Loading: React.FC<{ loading: LoadingConfig }> = ({ loading }) => (
	<div style={styles.loadingOverlay}>
		{loading.spinner !== false && <div style={styles.spinner} />}
		{loading.message && <div style={{ color: 'white', fontSize: '14px' }}>{loading.message}</div>}
	</div>
);

export const Sheet: React.FC<{ sheet: SheetConfig; onLocaleClose: () => void }> = ({ sheet, onLocaleClose }) => (
	<>
		<div style={styles.sheetOverlay} onClick={onLocaleClose} />
		<div style={{ ...styles.sheetContent, maxHeight: sheet.height === 'full' ? '90vh' : sheet.height === 'half' ? '50vh' : 'auto' }}>
			<div style={styles.sheetHandle} onClick={onLocaleClose} />
			{sheet.title && <div style={{ ...styles.title, marginBottom: '16px' }}>{sheet.title}</div>}
			{sheet.content}
		</div>
	</>
);
