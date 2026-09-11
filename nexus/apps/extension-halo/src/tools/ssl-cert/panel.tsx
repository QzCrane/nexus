// goal: SSL Cert panel UI

import type React from 'react';
import { useMemo } from 'react';
import { useTranslation } from '../../i18n';
import { parseCertificate } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const SslCertPanel: React.FC = () => {
    const { t } = useTranslation();
    const [input, setInput] = useToolState<string>('ssl-cert-input', '');


    const [info, error] = useMemo(() => {
        if (!input.includes('-----BEGIN CERTIFICATE-----')) return [null, null] as const;
        const parsed = parseCertificate(input);
        // A block that cannot be decoded is reported, never silently ignored.
        return [parsed, parsed ? null : t('sslCert.invalid', { defaultValue: 'This PEM block could not be decoded as an X.509 certificate.' })] as const;
    }, [input, t]);

    return (
        <div style={styles.wrapper}>
            <div>
                <div style={styles.label}>{t('sslCert.input', { defaultValue: 'PEM Certificate' })}</div>
                <textarea 
                    style={styles.textarea} 
                    value={input} 
                    onChange={(e) => setInput(e.target.value)} 
                    placeholder={t('sslCert.placeholder', { defaultValue: '-----BEGIN CERTIFICATE-----...' })} 
                />
            </div>

            {error && <div style={{ color: '#d33', fontSize: '12px', padding: '4px 0' }}>{error}</div>}

            {info && (
                <div style={styles.result}>
                    <div style={styles.row}>
                        <span style={styles.label}>Subject CN</span>
                        <span style={styles.value}>{info.subject.CN ?? '—'}</span>
                    </div>
                    <div style={styles.row}>
                        <span style={styles.label}>Issuer CN</span>
                        <span style={styles.value}>{info.issuer.CN ?? '—'}</span>
                    </div>
                    <div style={styles.row}>
                        <span style={styles.label}>Serial</span>
                        <span style={styles.value}>{info.serialNumber}</span>
                    </div>
                    <div style={styles.row}>
                        <span style={styles.label}>Valid From</span>
                        <span style={styles.value}>{info.validFrom}</span>
                    </div>
                    <div style={styles.row}>
                        <span style={styles.label}>{t('sslCert.validTo', { defaultValue: 'Valid To' })}</span>
                        <span style={styles.value}>{info.validTo}</span>
                    </div>
                    <div style={{fontSize: '11px', color: 'var(--halo-text-muted)', marginTop: '8px'}}>
                        {t('sslCert.note', { defaultValue: '* Basic parsing only. For full details, use openssl.' })}
                    </div>
                </div>
            )}
        </div>
    );
};
