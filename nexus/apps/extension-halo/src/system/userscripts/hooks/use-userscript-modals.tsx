import React, { useEffect } from 'react';
import { useOverlay } from '../../../components/ui/overlay';
import type { OverlayContextType } from '../../../components/ui/overlay/types';
import { ImportExportModal } from '../components/ImportExportModal';
import { SettingsModal } from '../components/SettingsModal';

export function useUserscriptModals(
    modalMode: 'import' | 'export' | null,
    setModalMode: (v: 'import' | 'export' | null) => void,
    exportData: string,
    handleImport: (json: string) => void,
    handleToolbarConfig: (config: any) => void,
    toolbarConfig: any,
    overlay: OverlayContextType,
    t: any
) {
    useEffect(() => {
        if (modalMode) {
            overlay.showModal({
                title: modalMode === 'export' 
                    ? `📤 ${t('userscripts.exportTitle', { defaultValue: 'Export Scripts' })}`
                    : `📥 ${t('userscripts.importTitle', { defaultValue: 'Import Scripts' })}`,
                message: '',
                hideFooter: true,
                content: (
                    <ImportExportModal 
                        mode={modalMode} 
                        exportData={exportData} 
                        onImport={(json) => { handleImport(json); overlay.closeModal(); setModalMode(null); }}
                        onClose={() => { overlay.closeModal(); setModalMode(null); }} 
                        t={t}
                    />
                ),
                onCancel: () => setModalMode(null)
            });
        }
    }, [modalMode, exportData, handleImport, overlay, setModalMode, t]);

    const openSettings = () => {
        overlay.showModal({
            title: t('userscripts.settings') || 'Settings',
            message: '',
            hideFooter: true,
            content: (
                <SettingsModal
                    config={toolbarConfig || { order: ['add', 'export', 'import'], hideOnOverflow: false }}
                    onSave={handleToolbarConfig}
                    onClose={overlay.closeModal}
                    t={t}
                />
            )
        });
    };

    return { openSettings };
}
