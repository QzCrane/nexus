// goal: Page Annotate panel UI

import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../i18n';
import { startAnnotation, stopAnnotation } from './core';
import { styles } from './panel.styles';
import type { FrameToolSession } from '../../content/frame-tool-messages';


export const PageAnnotatePanel: React.FC = () => {
    const { t } = useTranslation();
    const [active, setActive] = useState(false);
    const sessionRef = useRef<FrameToolSession | null>(null);


    const toggle = async () => {
        if (active) {
            const session = sessionRef.current;
            sessionRef.current = null;
            if (session) await stopAnnotation(session);
            setActive(false);
        } else {
            sessionRef.current = await startAnnotation();
            setActive(true);
        }
    };

    // Cleanup
    useEffect(() => {
		return () => {
			const session = sessionRef.current;
			sessionRef.current = null;
			if (session) void stopAnnotation(session).catch(() => undefined);
		};
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
