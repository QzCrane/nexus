// goal: Font Inspector panel UI - display page fonts

import type React from 'react';
import { useCallback } from 'react';
import { useTranslation } from '../../i18n';
import type { FontInfo } from './types';
import { fontInfoCodec, getPageFonts, groupByFamily, getGoogleFontsUrl } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';
import { useOwnedAsyncTask } from '../../kernel/hooks/use-owned-async-task';
import { StorageRecoveryActions } from '../../components/sidepanel/StorageRecoveryActions';


export const FontInspectorPanel: React.FC = () => {
	const { t } = useTranslation();
	const [fonts, setFonts, , fontsRecovery] = useToolState<FontInfo[]>('font-inspector-data', [], { codec: fontInfoCodec });
	const task = useOwnedAsyncTask();
	const [scanned, setScanned] = useToolState<boolean>('font-inspector-scanned', false);


	// Scan page
	const handleScan = useCallback(async () => {
		const outcome = await task.run(() => getPageFonts());
		if (outcome.kind === 'succeeded') {
			setFonts(outcome.value);
			setScanned(true);
		}
	}, [setScanned, setFonts, task.run]);

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
			<StorageRecoveryActions recovery={fontsRecovery} emptyValue={[]} exportName="halo-font-scan-damaged.json" />
			{/* Scan Button */}
			<button type="button" style={styles.btn} onClick={handleScan} disabled={task.phase === 'running'}>
				{task.phase === 'running' ? '⏳' : '🔍'} {t('fontInspector.scan')}
			</button>
			{task.error !== null && <div role="alert" style={{ color: 'var(--halo-danger, #d33)', fontSize: '12px' }}>{String(task.error)}</div>}

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
									{variants.map((v) => (
										<span key={`${v.weight}:${v.size}`} style={styles.variant}>
											{v.weight} • {v.size} • &lt;{v.element}&gt;
										</span>
									))}
								</div>
								<div style={styles.actions}>
									<button type="button" style={styles.actionBtn} onClick={() => handleCopy(family)}>📋 Copy</button>
									<button type="button" style={styles.actionBtn} onClick={() => handleGoogleFonts(family)}>🔗 Google Fonts</button>
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
