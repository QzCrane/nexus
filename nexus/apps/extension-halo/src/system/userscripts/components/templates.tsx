
import React from 'react';
import { useTranslation } from '../../../i18n';
import { styles } from '../styles';
import { SCRIPT_TEMPLATES } from '../templates';

interface UserscriptsTemplatesProps {
    onLoad: (key: keyof typeof SCRIPT_TEMPLATES) => void;
}

export const UserscriptsTemplates: React.FC<UserscriptsTemplatesProps> = ({ onLoad }) => {
    const { t } = useTranslation();

    return (
        <div>
            <div style={styles.sectionTitle}>📋 {t('userscripts.templates', { defaultValue: 'Templates' })}</div>
            <div style={styles.templatesGrid}>
                {Object.entries(SCRIPT_TEMPLATES).map(([key, tpl]) => {
                    const tplNameKey = key === 'adblock' ? 'tplAdblock'
                        : key === 'darkForce' ? 'tplDarkForce'
                        : key === 'removeOverlay' ? 'tplRemoveOverlay'
                        : key === 'customCSS' ? 'tplCustomCSS'
                        : 'tplBlockSpace';
                    const tplIcon = key === 'adblock' ? '🚫' : key === 'darkForce' ? '🌙' : key === 'removeOverlay' ? '🪟' : key === 'customCSS' ? '🎨' : '⌨️';
                    return (
                        <button key={key} style={styles.templateBtn} onClick={() => onLoad(key as keyof typeof SCRIPT_TEMPLATES)}>
                            <span style={styles.templateIcon}>{tplIcon}</span>
                            <span style={{ fontSize: '11px' }}>{t(`userscripts.${tplNameKey}`, { defaultValue: tpl.name.split(' ')[0] })}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
