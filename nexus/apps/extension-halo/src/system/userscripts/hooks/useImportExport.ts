import { useState } from 'react';
import { useTranslation } from '../../../i18n';
import type { UserScript } from '../types';
import {
	exportScripts,
	importScripts
} from '../core';
import { useOverlay } from '../../../components/ui';

export function useImportExport(loadScripts: () => Promise<void>) {
	const { t } = useTranslation();
	const { showToast } = useOverlay();
	const [modalMode, setModalMode] = useState<'import' | 'export' | null>(null);
	const [exportData, setExportData] = useState('');

	const handleExport = async (scripts: UserScript[]) => {
		setExportData(exportScripts(scripts));
		setModalMode('export');
	};

	const handleImport = async (json: string) => {
		try {
			const result = await importScripts(json);
			showToast({ message: `✅ ${t('userscripts.importSuccess', { defaultValue: `Imported ${result.imported} scripts` })}` });
			await loadScripts();
			setModalMode(null);
		} catch (e) {
			showToast({ message: `❌ ${t('userscripts.importFailed')}` });
		}
	};

	return {
		modalMode,
		setModalMode,
		exportData,
		handleExport,
		handleImport
	};
}
