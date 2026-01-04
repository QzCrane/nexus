// goal: Extension manager filter bar
// eff: Handles state and group filtering

import React from 'react';
import { useTranslation } from '../../../i18n';
import { DEFAULT_GROUPS } from '../types';
import { styles } from '../panel.styles';

export type FilterType = 'all' | 'enabled' | 'disabled' | 'none' | 'dev' | 'work' | 'entertainment' | 'other';

interface ExtensionFilterProps {
	currentFilter: string;
	onFilterChange: (filter: FilterType) => void;
}

export const ExtensionFilter: React.FC<ExtensionFilterProps> = ({
	currentFilter,
	onFilterChange,
}) => {
	const { t } = useTranslation();

	const filters: { key: FilterType; label: string }[] = [
		{ key: 'all', label: t('extMgr.all') },
		{ key: 'enabled', label: t('extMgr.enabled') },
		{ key: 'disabled', label: t('extMgr.disabled') },
		{ key: 'none', label: t('extMgr.noGroup') || '🌑 Uncategorized' },
		...Object.entries(DEFAULT_GROUPS).map(([k, v]) => ({
			key: k as FilterType,
			label: `${v.icon} ${t(v.label)}`
		})),
	];

	return (
		<div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
			{filters.map(f => (
				<button
					key={f.key}
					style={{ ...styles.filterBtn, ...(currentFilter === f.key ? styles.filterBtnActive : {}) }}
					onClick={() => onFilterChange(f.key)}
				>
					{f.label}
				</button>
			))}
		</div>
	);
};
