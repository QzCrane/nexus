import React from 'react';
import type { TranslationFunction } from '../../../i18n';
import { styles } from '../styles';

interface ImportExportModalProps {
	mode: 'import' | 'export';
	exportData?: string;
	onImport: (json: string) => void;
	onClose: () => void;
	t: TranslationFunction;
}

export const ImportExportModal: React.FC<ImportExportModalProps> = ({
	mode,
	exportData,
	onImport,
	onClose,
	t,
}) => {
	const [importText, setImportText] = React.useState('');
	const [copied, setCopied] = React.useState(false);

	const handleCopy = () => {
		if (exportData) {
			navigator.clipboard.writeText(exportData);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		}
	};

	const handleImport = () => {
		if (importText.trim()) onImport(importText);
	};

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
			{/* Content */}
			{mode === 'export' ? (
				<>
					<textarea
						style={{ ...styles.textarea, minHeight: '120px' }}
						value={exportData || ''}
						readOnly
					/>
					<button type="button" style={styles.btn} onClick={handleCopy}>
						{copied
							? `✅ ${t('common.copied', { defaultValue: 'Copied!' })}`
							: `📋 ${t('common.copy', { defaultValue: 'Copy to Clipboard' })}`}
					</button>
				</>
			) : (
				<>
					<textarea
						style={{ ...styles.textarea, minHeight: '120px' }}
						value={importText}
						onChange={(e) => setImportText(e.target.value)}
						placeholder={t('userscripts.importPlaceholder', { defaultValue: 'Paste exported JSON here...' })}
					/>
					<div style={styles.btnGroup}>
						<button type="button" style={styles.btn} onClick={handleImport}>
							📥 {t('userscripts.import', { defaultValue: 'Import' })}
						</button>
						<button type="button" style={styles.btnSecondary} onClick={onClose}>
							{t('common.close', { defaultValue: 'Close' })}
						</button>
					</div>
				</>
			)}
			
			{mode === 'export' && (
				<button type="button" style={styles.btnSecondary} onClick={onClose}>
					{t('common.close', { defaultValue: 'Close' })}
				</button>
			)}
		</div>
	);
};
