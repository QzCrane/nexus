
// goal: Screenshot Panel UI
// scope: module

import React, { useState, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import { captureVisible, downloadScreenshot, copyToClipboard } from './core';

const styles: Record<string, React.CSSProperties> = {
    container: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
    },
    actions: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '10px',
    },
    btn: {
        padding: '12px',
        border: 'none',
        borderRadius: '8px',
        background: 'var(--halo-bg-secondary, #333)',
        color: 'var(--halo-text, #fff)',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
        fontSize: '12px',
        transition: 'background 0.2s',
    },
    btnPrimary: {
        background: 'var(--halo-accent, #7c3aed)',
    },
    previewContainer: {
        position: 'relative',
        borderRadius: '8px',
        overflow: 'hidden',
        border: '1px solid var(--halo-border, #444)',
        background: '#000',
        minHeight: '200px',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
    },
    previewImg: {
        maxWidth: '100%',
        maxHeight: '400px',
        objectFit: 'contain',
    },
    toolbar: {
        display: 'flex',
        gap: '10px',
        justifyContent: 'center',
        marginTop: '8px',
    },
    toolBtn: {
        padding: '8px 16px',
        borderRadius: '6px',
        border: '1px solid var(--halo-border, #444)',
        background: 'var(--halo-bg-tertiary, #222)',
        color: 'var(--halo-text-secondary, #ccc)',
        cursor: 'pointer',
        fontSize: '12px',
    },
    toast: {
        position: 'fixed',
        bottom: '60px',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '8px 16px',
        background: 'var(--halo-accent, #7c3aed)',
        borderRadius: '20px',
        color: '#fff',
        fontSize: '12px',
        zIndex: 100,
    }
};

export const ScreenshotPanel: React.FC = () => {
    const { t } = useTranslation();
    const [image, setImage] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [toast, setToast] = useState<string | null>(null);

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(null), 2000);
    };

    const handleCapture = async () => {
        setLoading(true);
        try {
            // Small delay to allow UI to settle if anything changed
            setTimeout(async () => {
                try {
                    const dataUrl = await captureVisible();
                    setImage(dataUrl);
                } catch (err) {
                    console.error('Capture failed', err);
                    showToast(t('screenshotPanel.captureFailed'));
                } finally {
                    setLoading(false);
                }
            }, 100);
        } catch (err) {
            setLoading(false);
        }
    };

    const handleDownload = () => {
        if (!image) return;
        downloadScreenshot(image, `halo-snap-${Date.now()}.png`);
        showToast(t('screenshotPanel.downloaded'));
    };

    const handleCopy = async () => {
        if (!image) return;
        const ok = await copyToClipboard(image);
        showToast(ok ? t('screenshotPanel.copied') : t('screenshotPanel.copyFailed'));
    };

    return (
        <div style={styles.container}>
            <div style={styles.actions}>
                <button 
                    style={{...styles.btn, ...styles.btnPrimary}} 
                    onClick={handleCapture}
                    disabled={loading}
                >
                    <span style={{fontSize: '20px'}}>📸</span>
                    {loading ? t('screenshotPanel.capturing') : t('screenshotPanel.captureVisible')}
                </button>
            </div>

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

            {toast && <div style={styles.toast}>{toast}</div>}
        </div>
    );
};
