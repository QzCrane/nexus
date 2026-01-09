// goal: HTTP Status panel UI - status code reference

import React, { useState, useMemo } from 'react';
import { useTranslation } from '../../i18n';
import { searchStatuses, CATEGORY_INFO } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const HttpStatusPanel: React.FC = () => {
	const { t } = useTranslation();
	const [query, setQuery] = useToolState<string>('http-status', '');


	const results = useMemo(() => searchStatuses(query), [query]);

	// Group by category
	const grouped = useMemo(() => {
		const groups: Record<string, typeof results> = {};
		for (const status of results) {
			if (!groups[status.category]) groups[status.category] = [];
			groups[status.category]!.push(status);
		}
		return groups;
	}, [results]);

	// Copy to clipboard
	const handleCopy = (code: number, name: string) => {
		navigator.clipboard.writeText(`${code} ${name}`);
	};

	return (
		<div style={styles.wrapper}>
			{/* Search */}
			<input
				style={styles.search}
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				placeholder={t('httpStatus.search')}
			/>

			{/* Results */}
			<div style={styles.list}>
				{Object.entries(grouped).map(([cat, statuses]) => {
					const info = CATEGORY_INFO[cat as keyof typeof CATEGORY_INFO];
					return (
						<React.Fragment key={cat}>
							<div style={{ ...styles.sectionTitle, color: info.color }}>
								{info.icon} {info.label}
							</div>
							{statuses.map((status) => (
								<div key={status.code} style={styles.item} onClick={() => handleCopy(status.code, status.name)}>
									<span style={{ ...styles.code, color: info.color }}>{status.code}</span>
									<div style={styles.info}>
										<div style={styles.name}>{status.name}</div>
										<div style={styles.desc}>{status.description}</div>
									</div>
								</div>
							))}
						</React.Fragment>
					);
				})}
			</div>
		</div>
	);
};
