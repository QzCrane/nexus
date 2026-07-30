import { useCallback, useState } from 'react';
import { useTranslation } from '../../../i18n';
import type { UserScript } from '../types';
import {
	exportScripts,
	importScripts
} from '../core';
import { useToast } from '../../../components/ToastProvider';

export function useImportExport(loadScripts: () => Promise<void>) {
	const { t } = useTranslation();
	const { showToast } = useToast();
	const [modalMode, setModalMode] = useState<'import' | 'export' | null>(null);
	const [exportData, setExportData] = useState('');

	const handleExport = useCallback((scripts: UserScript[]) => {
		setExportData(exportScripts(scripts));
		setModalMode('export');
	}, []);

	const handleImport = useCallback(async (json: string) => {
		try {
			const result = await importScripts(json);
			showToast(`✅ ${t('userscripts.importSuccess', { defaultValue: `Imported ${result.imported} scripts` })}`);
			await loadScripts();
			setModalMode(null);
		} catch (_e) {
			showToast(`❌ ${t('userscripts.importFailed')}`);
		}
	}, [loadScripts, showToast, t]);

	return {
		modalMode,
		setModalMode,
		exportData,
		handleExport,
		handleImport
	};
}
