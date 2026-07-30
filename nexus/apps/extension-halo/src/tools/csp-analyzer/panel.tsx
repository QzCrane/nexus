// goal: CSP Analyzer panel UI

import type React from 'react';
import { useMemo } from 'react';
import { useTranslation } from '../../i18n';
import { parseCsp, calculateScore } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const CspAnalyzerPanel: React.FC = () => {
    const { t } = useTranslation();
    const [input, setInput] = useToolState<string>('csp-analyzer', '');


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
                    🛡️ {t('cspAnalyzer.score', { defaultValue: 'Score' })}: {score}/100
                </div>
            )}


            <div style={styles.list}>
                {directives.map((d, i) => {
                    // biome-ignore lint/suspicious/noArrayIndexKey: Parsed CSP directive order is the immutable source position for this stateless projection.
                    return <div key={i} style={d.isUnsafe ? styles.cardUnsafe : styles.card}>
                        <div style={styles.name}>{d.name}</div>
                        <div style={styles.desc}>{d.description}</div>
                        <div style={styles.values}>
                            {d.values.map((v, j) => {
                                // biome-ignore lint/suspicious/noArrayIndexKey: Repeated CSP tokens are distinguished only by their immutable source position.
                                return <span key={j} style={(v.includes('unsafe') || v === '*') ? styles.tagUnsafe : styles.tag}>
                                    {v}
                                </span>;
                            })}
                        </div>
                    </div>;
                })}
            </div>
        </div>
    );
};
