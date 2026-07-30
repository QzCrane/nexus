// goal: Page Annotate panel UI

import type React from 'react';
import { useEffect } from 'react';
import { useTranslation } from '../../i18n';
import { startAnnotation, stopAnnotation } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const PageAnnotatePanel: React.FC = () => {
    const { t } = useTranslation();
    const [active, setActive] = useToolState<boolean>('page-annotate-active', false);


    const toggle = async () => {
        if (active) {
            await stopAnnotation();
            setActive(false);
        } else {
            await startAnnotation();
            setActive(true);
        }
    };

    // Cleanup
    useEffect(() => {
        return () => { stopAnnotation(); };
    }, []);

    return (
        <div style={styles.wrapper}>
            <button type="button" style={{...styles.btn, background: active ? '#ef4444' : 'var(--halo-accent)'}} onClick={toggle}>
                <span style={styles.icon}>{active ? '🛑' : '🖌️'}</span>
                <span>{active ? t('pageAnnotate.stop', { defaultValue: 'Stop Annotation' }) : t('pageAnnotate.start', { defaultValue: 'Start Annotation' })}</span>
            </button>
            <div style={styles.desc}>
                {active ? t('pageAnnotate.activeDesc', { defaultValue: 'Drawing mode active. Use the toolbar on the page.' }) : t('pageAnnotate.inactiveDesc', { defaultValue: 'Click to draw on the current page.' })}
            </div>

        </div>
    );
};
