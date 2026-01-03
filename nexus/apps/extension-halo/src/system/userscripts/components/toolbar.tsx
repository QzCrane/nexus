
import React from 'react';
import { useTranslation } from '../../../i18n';
import { styles } from '../styles';

interface UserscriptsToolbarProps {
    config: { order: string[]; hideOnOverflow: boolean } | undefined;
    onAdd: () => void;
    onExport: () => void;
    onImport: () => void;
}

export const UserscriptsToolbar: React.FC<UserscriptsToolbarProps> = ({ config, onAdd, onExport, onImport }) => {
    const { t } = useTranslation();
    const order = config?.order || ['add', 'export', 'import'];
    const hideOnOverflow = config?.hideOnOverflow || false;

    const items: Record<string, React.ReactNode> = {
        'add': (
            <button key="add" style={styles.btn} onClick={onAdd}>
                ➕ {t('userscripts.addNew', { defaultValue: 'Add Script' })}
            </button>
        ),
        'export': (
            <button key="export" style={styles.btnSecondary} onClick={onExport}>
                📤 {t('userscripts.export', { defaultValue: 'Export' })}
            </button>
        ),
        'import': (
            <button key="import" style={styles.btnSecondary} onClick={onImport}>
                📥 {t('userscripts.import', { defaultValue: 'Import' })}
            </button>
        )
    };

    return (
        <div style={{
            ...styles.btnGroup,
            flexWrap: hideOnOverflow ? 'nowrap' : 'wrap',
            overflowX: hideOnOverflow ? 'hidden' : 'visible',
        }}>
            {order.map(key => items[key])}
        </div>
    );
};
