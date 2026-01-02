// goal: DOM Selector panel UI

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import { startSelection, stopSelection } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const DomSelectorPanel: React.FC = () => {
    const { t } = useTranslation();
    const [selecting, setSelecting] = useState(false);
    const [css, setCss] = useToolState<string>('dom-selector-css' as any, '');
    const [xpath, setXpath] = useToolState<string>('dom-selector-xpath' as any, '');


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
        const listener = (message: any, sender: chrome.runtime.MessageSender, sendResponse: (r?: any) => void) => {
            if (message.type === 'HALO_DOM_SELECTED') {
                setCss(message.payload.css);
                setXpath(message.payload.xpath);
                setSelecting(false); // Auto stop
            }
            return undefined;
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => { stopSelection(); };
    }, []);

    return (
        <div style={styles.wrapper}>
            <button style={selecting ? styles.btnActive : styles.btn} onClick={toggleSelection}>
                {selecting ? t('domSelector.stop', { defaultValue: 'Stop Selection' }) : t('domSelector.start', { defaultValue: 'Start Selection' })}
            </button>


            {selecting && <div style={{textAlign: 'center', fontSize: '12px', color: 'var(--halo-text-muted)'}}>{t('domSelector.hover', { defaultValue: 'Hover and click any element on the page...' })}</div>}


            {css && (
                <div>
                    <div style={styles.header}>
                        <div style={styles.label}>CSS Selector</div>
                        <button style={styles.copyBtn} onClick={() => navigator.clipboard.writeText(css)}>{t('common.copy', { defaultValue: 'Copy' })}</button>
                    </div>

                    <textarea style={styles.textarea} value={css} readOnly />
                </div>
            )}

            {xpath && (
                <div>
                    <div style={styles.header}>
                        <div style={styles.label}>XPath</div>
                        <button style={styles.copyBtn} onClick={() => navigator.clipboard.writeText(xpath)}>{t('common.copy', { defaultValue: 'Copy' })}</button>
                    </div>

                    <textarea style={styles.textarea} value={xpath} readOnly />
                </div>
            )}
        </div>
    );
};
