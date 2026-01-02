// goal: Font Inspector panel UI - display page fonts

import React, { useState, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import type { FontInfo } from './types';
import { getPageFonts, groupByFamily, getGoogleFontsUrl } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const FontInspectorPanel: React.FC = () => {
	const { t } = useTranslation();
	const [fonts, setFonts] = useToolState<FontInfo[]>('font-inspector-data' as any, []);
	const [loading, setLoading] = useState(false);
	const [scanned, setScanned] = useToolState<boolean>('font-inspector-scanned' as any, false);


	// Scan page
	const handleScan = useCallback(async () => {
		setLoading(true);
		const result = await getPageFonts();
		setFonts(result);
		setLoading(false);
		setScanned(true);
	}, []);

	// Copy font name
	const handleCopy = useCallback((family: string) => {
		navigator.clipboard.writeText(family);
	}, []);

	// Open Google Fonts
	const handleGoogleFonts = useCallback((family: string) => {
		window.open(getGoogleFontsUrl(family), '_blank');
	}, []);

	const grouped = groupByFamily(fonts);

	return (
		<div style={styles.wrapper}>
			{/* Scan Button */}
			<button style={styles.btn} onClick={handleScan} disabled={loading}>
				{loading ? '⏳' : '🔍'} {t('fontInspector.scan')}
			</button>

			{/* Results */}
			{scanned && (
				<div style={styles.list}>
					{grouped.size === 0 ? (
						<div style={styles.empty}>🔤 {t('fontInspector.noFonts')}</div>
					) : (
						Array.from(grouped.entries()).map(([family, variants]) => (
							<div key={family} style={styles.family}>
								<div style={{ ...styles.familyName, fontFamily: family }}>{family}</div>
								<div style={{ ...styles.sample, fontFamily: family }}>
									The quick brown fox jumps over the lazy dog
								</div>
								<div style={styles.variants}>
									{variants.map((v, i) => (
										<span key={i} style={styles.variant}>
											{v.weight} • {v.size} • &lt;{v.element}&gt;
										</span>
									))}
								</div>
								<div style={styles.actions}>
									<button style={styles.actionBtn} onClick={() => handleCopy(family)}>📋 Copy</button>
									<button style={styles.actionBtn} onClick={() => handleGoogleFonts(family)}>🔗 Google Fonts</button>
								</div>
							</div>
						))
					)}
				</div>
			)}

			{!scanned && (
				<div style={styles.empty}>🔤 {t('fontInspector.clickToScan')}</div>
			)}
		</div>
	);
};
