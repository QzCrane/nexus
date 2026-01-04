// goal: Extension manager batch actions toolbar
// eff: Handles bulk enable/disable logic

import React from 'react';
import { useTranslation } from '../../../i18n';
import { styles } from '../panel.styles';

interface BatchActionToolbarProps {
	disabledCount: number;
	enabledCount: number;
	totalCount: number;
	onBatchEnable: () => void;
	onBatchDisable: () => void;
}

export const BatchActionToolbar: React.FC<BatchActionToolbarProps> = ({
	disabledCount,
	enabledCount,
	totalCount,
	onBatchEnable,
	onBatchDisable,
}) => {
	const { t } = useTranslation();

	return (
		<div style={styles.batchActions}>
			<button
				style={{ ...styles.batchBtn, opacity: disabledCount === 0 ? 0.5 : 1 }}
				onClick={onBatchEnable}
				disabled={disabledCount === 0}
			>
				{t('extMgr.enableAll')} ({disabledCount})
			</button>
			<button
				style={{ ...styles.batchBtn, background: '#ef4444', opacity: enabledCount === 0 ? 0.5 : 1 }}
				onClick={onBatchDisable}
				disabled={enabledCount === 0}
			>
				{t('extMgr.disableAll')} ({enabledCount})
			</button>
			<span style={{ flex: 1 }} />
			<span style={{ fontSize: '12px', color: 'var(--halo-text-muted)' }}>
				{totalCount} {t('common.tools')}
			</span>
		</div>
	);
};
