// goal: Shortcuts panel UI - keyboard shortcuts reference

import type React from 'react';
import { useMemo } from 'react';
import { useTranslation } from '../../i18n';
import { searchShortcuts } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const ShortcutsPanel: React.FC = () => {
	const { t } = useTranslation();
	const [query, setQuery] = useToolState<string>('shortcuts-query', '');


	const groups = useMemo(() => searchShortcuts(query), [query]);

	// Parse keys into array for display
	const parseKeys = (keys: string): string[] => {
		return keys.split('+').map((k) => k.trim());
	};

	return (
		<div style={styles.wrapper}>
			{/* Search */}
			<input
				style={styles.search}
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				placeholder={t('shortcuts.search')}
			/>

			{/* Groups */}
			<div style={{ maxHeight: '400px', overflowY: 'auto' }}>
				{groups.length === 0 ? (
					<div style={styles.empty}>⌨️ {t('shortcuts.noResults')}</div>
				) : (
					groups.map((group) => (
						<div key={group.name} style={styles.group}>
							<div style={styles.groupTitle}>
								<span>{group.icon}</span>
								<span>{group.name}</span>
							</div>
							<div style={styles.list}>
								{group.shortcuts.map((shortcut) => (
									<div key={`${shortcut.keys}:${shortcut.description}`} style={styles.item}>
										<div style={styles.keys}>
											{parseKeys(shortcut.keys).map((key) => (
												<span key={`${shortcut.keys}:${key}`} style={styles.key}>{key}</span>
											))}
										</div>
										<span style={styles.desc}>{shortcut.description}</span>
									</div>
								))}
							</div>
						</div>
					))
				)}
			</div>
		</div>
	);
};
