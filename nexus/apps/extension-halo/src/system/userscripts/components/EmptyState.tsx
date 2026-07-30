import type React from 'react';
import type { TranslationFunction } from '../../../i18n';
import { styles } from '../styles';

interface EmptyStateProps {
	t: TranslationFunction;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ t }) => (
	<div style={styles.emptyState}>
		<div style={styles.emptyIcon}>📜</div>
		<div>{t('userscripts.empty', { defaultValue: 'No scripts yet' })}</div>
		<div style={{ fontSize: '12px', marginTop: '4px', opacity: 0.7 }}>
			{t('userscripts.emptyDesc', { defaultValue: 'Add a script or choose a template to get started' })}
		</div>
	</div>
);
