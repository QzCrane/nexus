// goal: SSL Cert panel UI

import React, { useState, useMemo } from 'react';
import { useTranslation } from '../../i18n';
import { parseCertificate } from './core';
import { styles } from './panel.styles';

export const SslCertPanel: React.FC = () => {
    const { t } = useTranslation();
    const [input, setInput] = useState('');

    const info = useMemo(() => {
        if (!input.includes('-----BEGIN CERTIFICATE-----')) return null;
        return parseCertificate(input);
    }, [input]);

    return (
        <div style={styles.wrapper}>
            <div>
                <div style={styles.label}>PEM Certificate</div>
                <textarea 
                    style={styles.textarea} 
                    value={input} 
                    onChange={(e) => setInput(e.target.value)} 
                    placeholder="-----BEGIN CERTIFICATE-----..." 
                />
            </div>

            {info && (
                <div style={styles.result}>
                    <div style={styles.row}>
                        <span style={styles.label}>Valid From</span>
                        <span style={styles.value}>{info.validFrom}</span>
                    </div>
                    <div style={styles.row}>
                        <span style={styles.label}>Valid To</span>
                        <span style={styles.value}>{info.validTo}</span>
                    </div>
                    <div style={{fontSize: '11px', color: 'var(--halo-text-muted)', marginTop: '8px'}}>
                        * Basic parsing only. For full details, use openssl.
                    </div>
                </div>
            )}
        </div>
    );
};
