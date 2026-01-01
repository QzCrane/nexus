// goal: CSP Analyzer panel UI

import React, { useState, useMemo } from 'react';
import { useTranslation } from '../../i18n';
import { parseCsp, calculateScore } from './core';
import { styles } from './panel.styles';

export const CspAnalyzerPanel: React.FC = () => {
    const { t } = useTranslation();
    const [input, setInput] = useState('');

    const directives = useMemo(() => parseCsp(input), [input]);
    const score = useMemo(() => calculateScore(directives), [directives]);

    return (
        <div style={styles.wrapper}>
            <textarea 
                style={styles.textarea} 
                value={input} 
                onChange={(e) => setInput(e.target.value)} 
                placeholder="default-src 'self'; script-src 'unsafe-inline'..." 
            />

            {directives.length > 0 && (
                <div style={styles.score}>
                    🛡️ {t('cspAnalyzer.score', 'Score')}: {score}/100
                </div>
            )}

            <div style={styles.list}>
                {directives.map((d, i) => (
                    <div key={i} style={d.isUnsafe ? styles.cardUnsafe : styles.card}>
                        <div style={styles.name}>{d.name}</div>
                        <div style={styles.desc}>{d.description}</div>
                        <div style={styles.values}>
                            {d.values.map((v, j) => (
                                <span key={j} style={(v.includes('unsafe') || v === '*') ? styles.tagUnsafe : styles.tag}>
                                    {v}
                                </span>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
