// goal: Tech Stack panel UI - detect and display website technologies

import React, { useState, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { TechDetection, TechCategory } from './types';
import { detectTechStack, CATEGORY_LABELS } from './core';
import { styles } from './panel.styles';

export const TechStackPanel: React.FC = () => {
	const { t } = useTranslation();
	const [techs, setTechs] = useState<TechDetection[]>([]);
	const [loading, setLoading] = useState(false);
	const [scanned, setScanned] = useState(false);

	// Scan page
	const handleScan = useCallback(async () => {
		setLoading(true);
		const results = await detectTechStack();
		setTechs(results);
		setLoading(false);
		setScanned(true);
	}, []);

	// Group by category
	const grouped = techs.reduce<Record<TechCategory, TechDetection[]>>((acc, tech) => {
		if (!acc[tech.category]) acc[tech.category] = [];
		acc[tech.category].push(tech);
		return acc;
	}, {} as Record<TechCategory, TechDetection[]>);

	const categories = Object.keys(grouped) as TechCategory[];

	return (
		<div style={styles.wrapper}>
			{/* Scan Button */}
			<button style={styles.btn} onClick={handleScan} disabled={loading}>
				{loading ? '⏳' : '🔍'} {t('techStack.scan')}
			</button>

			{/* Summary */}
			{scanned && (
				<div style={styles.summary}>
					<div style={styles.stat}>
						<span style={styles.statValue}>{techs.length}</span>
						<span style={styles.statLabel}>{t('techStack.detected')}</span>
					</div>
					<div style={styles.stat}>
						<span style={styles.statValue}>{categories.length}</span>
						<span style={styles.statLabel}>{t('techStack.categories')}</span>
					</div>
				</div>
			)}

			{/* Results */}
			{scanned && (
				<Card variant="default" padding="sm">
					{techs.length === 0 ? (
						<div style={styles.empty}>🔍 {t('techStack.noTech')}</div>
					) : (
						categories.map((cat) => (
							<div key={cat} style={styles.category}>
								<div style={styles.categoryTitle}>{CATEGORY_LABELS[cat]}</div>
								<div style={styles.list}>
									{grouped[cat].map((tech) => (
										<div key={tech.name} style={styles.item}>
											<span style={styles.icon}>{tech.icon}</span>
											<span style={styles.name}>{tech.name}</span>
											{tech.version && <span style={styles.version}>v{tech.version}</span>}
										</div>
									))}
								</div>
							</div>
						))
					)}
				</Card>
			)}

			{/* Not scanned hint */}
			{!scanned && (
				<div style={styles.empty}>
					🌐 {t('techStack.clickToScan')}
				</div>
			)}
		</div>
	);
};
