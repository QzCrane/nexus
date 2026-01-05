
// goal: Screenshot Panel UI
// scope: module

import React, { useState, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import { captureVisible, captureWithDelay, downloadScreenshot, copyToClipboard } from './core';
import { useToolState } from '../../kernel';
import { useToast } from '../../components/ToastProvider';



const DELAY_OPTIONS = [0, 3, 5, 10]; // seconds

const styles: Record<string, React.CSSProperties> = {
    container: { display: 'flex', flexDirection: 'column', gap: '12px' },
    actions: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' },
    btn: {
        padding: '12px', border: 'none', borderRadius: '8px',
        background: 'var(--halo-bg-secondary)', color: 'var(--halo-text)',
        cursor: 'pointer', display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: '8px', fontSize: '12px', transition: 'all 0.2s',
    },
    btnPrimary: { background: 'var(--halo-accent)', color: '#fff' },
    btnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
    row: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
    label: { fontSize: '11px', fontWeight: 600, color: 'var(--halo-text-muted)', textTransform: 'uppercase' as const },
    delayBtn: {
        padding: '6px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
        cursor: 'pointer', transition: 'all 0.15s', border: '1px solid var(--halo-border)',
        background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-secondary)',
    },
    delayActive: { background: 'var(--halo-accent)', color: '#fff', borderColor: 'var(--halo-accent)' },
    previewContainer: {
        position: 'relative', borderRadius: '8px', overflow: 'hidden',
        border: '1px solid var(--halo-border)', background: '#000',
        minHeight: '150px', display: 'flex', justifyContent: 'center', alignItems: 'center',
    },
    previewImg: { maxWidth: '100%', maxHeight: '350px', objectFit: 'contain' },
    toolbar: { display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '8px' },
    toolBtn: {
        padding: '8px 16px', borderRadius: '6px', border: '1px solid var(--halo-border)',
        background: 'var(--halo-bg-tertiary)', color: 'var(--halo-text-secondary)',
        cursor: 'pointer', fontSize: '12px',
    },
    countdown: {
        fontSize: '48px', fontWeight: 700, color: 'var(--halo-accent)',
        textAlign: 'center', padding: '40px',
    },
};

export const ScreenshotPanel: React.FC = () => {
    const { t } = useTranslation();
    const { showToast } = useToast();
    const [image, setImage] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [delay, setDelay] = useToolState<number>('screenshot-delay' as any, 0);
    const [countdown, setCountdown] = useState<number | null>(null);

    const handleCapture = useCallback(async () => {
        if (loading) return;
        setLoading(true);
        setImage(null);
        
        try {
            if (delay > 0) {
                // Show countdown
                for (let i = delay; i > 0; i--) {
                    setCountdown(i);
                    await new Promise(r => setTimeout(r, 1000));
                }
                setCountdown(null);
            }
            // Small delay to ensure UI is hidden/settled
            await new Promise(r => setTimeout(r, 100));
            const dataUrl = await captureVisible();
            setImage(dataUrl);
            showToast(t('screenshotPanel.captured') || 'Captured!');
        } catch (err) {
            console.error('Capture failed', err);
            showToast(t('screenshotPanel.captureFailed'));
        } finally {
            setLoading(false);
            setCountdown(null);
        }
    }, [delay, loading, showToast, t]);

    const handleDownload = useCallback(() => {
        if (!image) return;
        downloadScreenshot(image, `halo-snap-${Date.now()}.png`);
        showToast(t('screenshotPanel.downloaded'));
    }, [image, showToast, t]);

    const handleCopy = useCallback(async () => {
        if (!image) return;
        const ok = await copyToClipboard(image);
        showToast(ok ? t('screenshotPanel.copied') : t('screenshotPanel.copyFailed'));
    }, [image, showToast, t]);

    return (
        <div style={styles.container}>
            {/* Delay Options */}
            <Card variant="default" padding="sm">
                <div style={styles.row}>
                    <span style={styles.label}>{t('screenshotPanel.delay') || 'Delay'}:</span>
                    {DELAY_OPTIONS.map((d) => (
                        <button
                            key={d}
                            style={{ ...styles.delayBtn, ...(delay === d ? styles.delayActive : {}) }}
                            onClick={() => setDelay(d)}
                        >
                            {d === 0 ? (t('screenshotPanel.noDelay') || 'None') : `${d}s`}
                        </button>
                    ))}
                </div>
            </Card>

            {/* Capture Button */}
            <button 
                style={{...styles.btn, ...styles.btnPrimary, ...(loading ? styles.btnDisabled : {})}} 
                onClick={handleCapture}
                disabled={loading}
            >
                <span style={{fontSize: '24px'}}>📸</span>
                {loading 
                    ? (countdown !== null ? `${countdown}...` : t('screenshotPanel.capturing'))
                    : t('screenshotPanel.captureVisible')
                }
            </button>

            {/* Countdown Display */}
            {countdown !== null && (
                <div style={styles.countdown}>{countdown}</div>
            )}

            {/* Preview */}
            {image && (
                <Card variant="default" padding="sm">
                    <div style={styles.previewContainer}>
                        <img src={image} style={styles.previewImg} alt="Screenshot" />
                    </div>
                    <div style={styles.toolbar}>
                        <button style={styles.toolBtn} onClick={handleCopy}>
                            📋 {t('screenshotPanel.copy')}
                        </button>
                        <button style={styles.toolBtn} onClick={handleDownload}>
                            💾 {t('screenshotPanel.save')}
                        </button>
                    </div>
                </Card>
            )}
        </div>
    );
};
