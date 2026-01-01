// goal: Page Annotate panel UI

import React, { useState, useEffect } from 'react';
import { useTranslation } from '../../i18n';
import { startAnnotation, stopAnnotation } from './core';
import { styles } from './panel.styles';

export const PageAnnotatePanel: React.FC = () => {
    const { t } = useTranslation();
    const [active, setActive] = useState(false);

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
            <button style={{...styles.btn, background: active ? '#ef4444' : 'var(--halo-accent)'}} onClick={toggle}>
                <span style={styles.icon}>{active ? '🛑' : '🖌️'}</span>
                <span>{active ? t('pageAnnotate.stop', 'Stop Annotation') : t('pageAnnotate.start', 'Start Annotation')}</span>
            </button>
            <div style={styles.desc}>
                {active ? t('pageAnnotate.activeDesc', 'Drawing mode active. Use the toolbar on the page.') : t('pageAnnotate.inactiveDesc', 'Click to draw on the current page.')}
            </div>
        </div>
    );
};
