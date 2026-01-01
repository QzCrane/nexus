// goal: Translate panel UI

import React, { useState } from 'react';
import { useTranslation } from '../../i18n';
import { openTranslation } from './core';
import { styles } from './panel.styles';

export const TranslatePanel: React.FC = () => {
    const { t } = useTranslation();
    const [text, setText] = useState('');

    return (
        <div style={styles.wrapper}>
            <div style={styles.section}>
                <div style={styles.label}>{t('translate.pageTitle', 'Translate Current Page')}</div>
                <div style={styles.btnGrid}>
                    <button style={{...styles.btn, ...styles.primary}} onClick={() => openTranslation('google')}>
                        {t('translate.useGoogle', 'Using Google')}
                    </button>
                    <button style={styles.btn} onClick={() => openTranslation('bing')}>
                        {t('translate.useBing', 'Using Bing')}
                    </button>
                </div>
            </div>

            <div style={styles.section}>
                <div style={styles.label}>{t('translate.textTitle', 'Translate Text')}</div>
                <textarea 
                    style={styles.textarea} 
                    value={text} 
                    onChange={e => setText(e.target.value)} 
                    placeholder={t('translate.textPlaceholder', 'Enter text to translate...')}
                />
                <div style={styles.btnGrid}>
                    <button style={styles.btn} onClick={() => openTranslation('google', text)}>
                        {t('translate.toGoogle', 'To Google')}
                    </button>
                    <button style={styles.btn} onClick={() => openTranslation('deepl', text)}>
                        {t('translate.toDeepL', 'To DeepL')}
                    </button>
                </div>
            </div>
        </div>
    );
};
