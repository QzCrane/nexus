import React, { useState } from 'react';
import { styles } from '../styles';
import { UserScriptState } from '../types';

interface SettingsModalProps {
	config: UserScriptState['toolbarConfig'];
	onSave: (config: UserScriptState['toolbarConfig']) => void;
	onClose: () => void;
	t: (key: string) => string;
}

const ITEMS_MAP: Record<string, string> = {
	'add': 'Add Script',
	'export': 'Export',
	'import': 'Import'
};

export const SettingsModal: React.FC<SettingsModalProps> = ({ config, onSave, onClose, t }) => {
	const [order, setOrder] = useState<string[]>(config?.order || ['add', 'export', 'import']);
	const [hideOnOverflow, setHideOnOverflow] = useState(config?.hideOnOverflow || false);

	const move = (index: number, dir: -1 | 1) => {
		const newOrder = [...order];
		const targetIndex = index + dir;
		if (targetIndex >= 0 && targetIndex < newOrder.length) {
			[newOrder[index], newOrder[targetIndex]] = [newOrder[targetIndex]!, newOrder[index]!];
			setOrder(newOrder);
		}
	};

	const handleSave = () => {
		if (!order.includes('add')) order.push('add');
		onSave({ order, hideOnOverflow });
		onClose();
	};

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
			<div>
				<label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '8px' }}>
					{t('userscripts.toolbarOrder') || 'Toolbar Order'}
				</label>
				<div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
					{order.map((item, i) => (
						<div key={item} style={{
							display: 'flex', alignItems: 'center', justifyContent: 'space-between',
							padding: '8px', background: 'var(--halo-bg-secondary, #f5f5f5)', borderRadius: '6px'
						}}>
							<span style={{ fontSize: '13px' }}>{/* TRANSLATE ME LATER IF NEEDED */ ITEMS_MAP[item]}</span>
							<div style={{ display: 'flex', gap: '4px' }}>
								<button onClick={() => move(i, -1)} disabled={i === 0} style={{ cursor: 'pointer', opacity: i === 0 ? 0.3 : 1, border: 'none', background: 'transparent' }}>⬆️</button>
								<button onClick={() => move(i, 1)} disabled={i === order.length - 1} style={{ cursor: 'pointer', opacity: i === order.length - 1 ? 0.3 : 1, border: 'none', background: 'transparent' }}>⬇️</button>
							</div>
						</div>
					))}
				</div>
			</div>

			<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
				<input
					type="checkbox"
					id="hideOverflow"
					checked={hideOnOverflow}
					onChange={(e) => setHideOnOverflow(e.target.checked)}
				/>
				<label htmlFor="hideOverflow" style={{ fontSize: '13px' }}>
					{t('userscripts.hideOnOverflow') || 'Hide text if no space'}
				</label>
			</div>

			<div style={styles.btnGroup}>
				<button style={styles.btn} onClick={handleSave}>{t('common.save') || 'Save'}</button>
				<button style={styles.btnSecondary} onClick={onClose}>{t('common.cancel') || 'Cancel'}</button>
			</div>
		</div>
	);
};
