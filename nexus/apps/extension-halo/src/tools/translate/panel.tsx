// goal: Translate panel UI

import type React from 'react';
import { useTranslation } from '../../i18n';
import { openTranslation } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const TranslatePanel: React.FC = () => {
    const { t } = useTranslation();
    const [text, setText] = useToolState<string>('translate-text', '');


    return (
        <div style={styles.wrapper}>
            <div style={styles.section}>
                <div style={styles.label}>{t('translate.pageTitle', { defaultValue: 'Translate Current Page' })}</div>
                <div style={styles.btnGrid}>
                    <button type="button" style={{...styles.btn, ...styles.primary}} onClick={() => openTranslation('google')}>
                        {t('translate.useGoogle', { defaultValue: 'Using Google' })}
                    </button>

                    <button type="button" style={styles.btn} onClick={() => openTranslation('bing')}>
                        {t('translate.useBing', { defaultValue: 'Using Bing' })}
                    </button>

                </div>
            </div>

            <div style={styles.section}>
                <div style={styles.label}>{t('translate.textTitle', { defaultValue: 'Translate Text' })}</div>
                <textarea 
                    style={styles.textarea} 
                    value={text} 
                    onChange={e => setText(e.target.value)} 
                    placeholder={t('translate.textPlaceholder', { defaultValue: 'Enter text to translate...' })}
                />

                <div style={styles.btnGrid}>
                    <button type="button" style={styles.btn} onClick={() => openTranslation('google', text)}>
                        {t('translate.toGoogle', { defaultValue: 'To Google' })}
                    </button>
                    <button type="button" style={styles.btn} onClick={() => openTranslation('deepl', text)}>
                        {t('translate.toDeepL', { defaultValue: 'To DeepL' })}
                    </button>

                </div>
            </div>
        </div>
    );
};
