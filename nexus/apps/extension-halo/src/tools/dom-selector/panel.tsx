// goal: DOM Selector panel UI

import type React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import { startSelection, stopSelection } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';
import { isDomSelectedMessage } from './types';


export const DomSelectorPanel: React.FC = () => {
    const { t } = useTranslation();
    const [selecting, setSelecting] = useState(false);
    const [css, setCss] = useToolState<string>('dom-selector-css', '');
    const [xpath, setXpath] = useToolState<string>('dom-selector-xpath', '');


    const toggleSelection = useCallback(async () => {
        if (selecting) {
            await stopSelection();
            setSelecting(false);
        } else {
            await startSelection();
            setSelecting(true);
        }
    }, [selecting]);

    // Listen for selection event
    useEffect(() => {
        const listener = (message: unknown): undefined => {
            if (isDomSelectedMessage(message)) {
                setCss(message.payload.css);
                setXpath(message.payload.xpath);
                setSelecting(false); // Auto stop
            }
            return undefined;
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
    }, [setXpath, setCss]);

    // Cleanup on unmount
    useEffect(() => {
        return () => { stopSelection(); };
    }, []);

    return (
        <div style={styles.wrapper}>
            <button type="button" style={selecting ? styles.btnActive : styles.btn} onClick={toggleSelection}>
                {selecting ? t('domSelector.stop', { defaultValue: 'Stop Selection' }) : t('domSelector.start', { defaultValue: 'Start Selection' })}
            </button>


            {selecting && <div style={{textAlign: 'center', fontSize: '12px', color: 'var(--halo-text-muted)'}}>{t('domSelector.hover', { defaultValue: 'Hover and click any element on the page...' })}</div>}


            {css && (
                <div>
                    <div style={styles.header}>
                        <div style={styles.label}>{t('domSelector.css', { defaultValue: 'CSS Selector' })}</div>
                        <button type="button" style={styles.copyBtn} onClick={() => navigator.clipboard.writeText(css)}>{t('common.copy', { defaultValue: 'Copy' })}</button>
                    </div>

                    <textarea style={styles.textarea} value={css} readOnly />
                </div>
            )}

            {xpath && (
                <div>
                    <div style={styles.header}>
                        <div style={styles.label}>{t('domSelector.xpath', { defaultValue: 'XPath' })}</div>
                        <button type="button" style={styles.copyBtn} onClick={() => navigator.clipboard.writeText(xpath)}>{t('common.copy', { defaultValue: 'Copy' })}</button>
                    </div>

                    <textarea style={styles.textarea} value={xpath} readOnly />
                </div>
            )}
        </div>
    );
};
