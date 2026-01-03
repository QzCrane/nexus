import React from 'react';
import { useTranslation } from '../../i18n';

interface ModuleStoreModalProps {
	isOpen: boolean;
	type: 'confirm' | 'alert';
	title?: string;
	message: string;
	onClose: () => void;
	onConfirm?: () => void;
}

const modalStyles = {
	overlay: {
		position: 'fixed' as const,
		top: 0, left: 0, right: 0, bottom: 0,
		background: 'rgba(0, 0, 0, 0.4)',
		backdropFilter: 'blur(4px)',
		zIndex: 1000,
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		padding: '24px',
	},
	content: {
		background: 'var(--halo-bg-primary)',
		borderRadius: '16px',
		padding: '24px',
		width: '100%',
		maxWidth: '320px',
		boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
		border: '1px solid var(--halo-border)',
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
	}
};

export const ModuleStoreModal: React.FC<ModuleStoreModalProps> = ({
	isOpen, type, title, message, onClose, onConfirm
}) => {
	const { t } = useTranslation();

	if (!isOpen) return null;

	return (
		<div style={modalStyles.overlay} onClick={onClose}>
			<div style={modalStyles.content} onClick={e => e.stopPropagation()}>
				{title && <div style={modalStyles.title}>{title}</div>}
				<div style={modalStyles.message}>{message}</div>
				<div style={modalStyles.actions}>
					<button 
						style={{...modalStyles.btn, ...modalStyles.btnCancel}}
						onClick={onClose}
					>
						{type === 'confirm' ? t('common.cancel') : t('moduleStorePanel.close') || '关闭'}
					</button>
					{type === 'confirm' && (
						<button 
							style={{...modalStyles.btn, ...modalStyles.btnConfirm}}
							onClick={onConfirm}
						>
							{t('moduleStorePanel.uninstall')}
						</button>
					)}
				</div>
			</div>
		</div>
	);
};
