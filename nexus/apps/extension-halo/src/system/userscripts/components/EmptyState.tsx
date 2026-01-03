import React from 'react';
import { styles } from '../styles';

type TFunc = (key: string, opts?: { defaultValue?: string } & Record<string, any>) => string;

interface EmptyStateProps {
	t: TFunc;
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
