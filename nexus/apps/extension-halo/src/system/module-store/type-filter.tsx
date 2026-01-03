
import React from 'react';
import { useTranslation } from '../../i18n';

export type FilterType = 'all' | 'app' | 'official' | 'userscript' | 'system';

interface TypeFilterProps {
	value: FilterType;
	onChange: (val: FilterType) => void;
}

export const TypeFilter: React.FC<TypeFilterProps> = ({ value, onChange }) => {
	const { t } = useTranslation();
	
	const typeFilters: { key: FilterType; label: string }[] = [
		{ key: 'all', label: t('moduleStorePanel.filters.all') },
		{ key: 'app', label: t('moduleStorePanel.filters.app') },
		{ key: 'official', label: t('common.builtInScripts') },
		{ key: 'userscript', label: t('common.userScripts') },
		{ key: 'system', label: t('moduleStorePanel.filters.system') },
	];

	return (
		<div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
			{typeFilters.map(f => (
				<button
					key={f.key}
					style={{
						padding: '4px 12px',
						borderRadius: '16px',
						border: 'none',
						fontSize: '12px',
						cursor: 'pointer',
						background: value === f.key ? 'var(--halo-accent)' : 'var(--halo-bg-secondary)',
						color: value === f.key ? '#fff' : 'var(--halo-text-secondary)',
						fontWeight: 500
					}}
					onClick={() => onChange(f.key)}
				>
					{f.label}
				</button>
			))}
		</div>
	);
};
