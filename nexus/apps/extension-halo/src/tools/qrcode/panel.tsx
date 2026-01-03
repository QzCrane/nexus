// goal: QR Code tool panel UI with generate + scan

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Card } from '@nexus/ui-kit';
import { createLogger } from '@nexus/kernel';
import { useTranslation } from '../../i18n';
import { generateQRCode, generateSVG } from './core';
import { saveToHistory, loadHistory, downloadQRCode, copyImageToClipboard } from './utils';
import { scanQRCodeFromFile, scanQRCodeFromClipboard } from './scan';
import type { ScanResult, QRCodeOptions } from './types';
import { DEFAULT_OPTIONS } from './types';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


import { useToast } from '../../components/ToastProvider';


const logger = createLogger('QRCode', 'HALO');
type TabMode = 'generate' | 'scan';

export const QRCodePanel: React.FC = () => {
	const { t } = useTranslation();
    const { showToast } = useToast();
	const [mode, setMode] = useToolState<TabMode>('qrcode-mode' as any, 'generate');
	const [text, setText] = useToolState<string>('qrcode', '');
	const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
	const [options, setOptions] = useToolState<Omit<QRCodeOptions, 'text'>>('qrcode-opts' as any, DEFAULT_OPTIONS);
	const [loading, setLoading] = useState(false);

	const [history, setHistory] = useState<string[]>([]);
	const [scanResult, setScanResult] = useState<ScanResult | null>(null);
	// const [toast, setToast] = useState<string | null>(null); // Removed locally
	
	const fileInputRef = useRef<HTMLInputElement>(null);
	const logoInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => { loadHistory().then(setHistory); }, []);
	// const showToast = ... // Removed local implementation

	const handleGenerate = useCallback(async () => {
		if (!text.trim()) return;
		setLoading(true);
		try {
			const dataUrl = await generateQRCode(text.trim(), options);
			setQrDataUrl(dataUrl);
			setHistory(await saveToHistory(text.trim()));
		} catch (e) { logger.error('QR Generate failed', e); showToast(t('qrcodePanel.failed')); }
		finally { setLoading(false); }
	}, [text, options, showToast, t]);

	const handleCopy = useCallback(async () => { if (qrDataUrl && await copyImageToClipboard(qrDataUrl)) showToast(t('qrcodePanel.copied')); }, [qrDataUrl, showToast, t]);

	const handleDownloadPNG = useCallback(async () => {
		if (!qrDataUrl) return;
		const res = await fetch(qrDataUrl);
		downloadQRCode(await res.blob(), `qr-${Date.now()}.png`);
		showToast(t('qrcodePanel.downloaded'));
	}, [qrDataUrl, showToast, t]);

	const handleDownloadSVG = useCallback(async () => {
		if (!text.trim()) return;
		const svg = await generateSVG(text.trim(), options);
		downloadQRCode(new Blob([svg], { type: 'image/svg+xml' }), `qr-${Date.now()}.svg`);
		showToast(t('qrcodePanel.downloaded'));
	}, [text, options, showToast, t]);

	const handleLogoUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file) {
			const reader = new FileReader();
			reader.onload = (ev) => setOptions(prev => ({ ...prev, logo: ev.target?.result as string }));
			reader.readAsDataURL(file);
		}
	}, []);

	const handleScanFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		setLoading(true);
		const result = await scanQRCodeFromFile(file);
		setScanResult(result);
		showToast(result ? t('qrcodePanel.scanSuccess') : t('qrcodePanel.scanFailed'));
		setLoading(false); e.target.value = '';
	}, [showToast, t]);

	const handleScanClipboard = useCallback(async () => {
		setLoading(true);
		const result = await scanQRCodeFromClipboard();
		setScanResult(result);
		showToast(result ? t('qrcodePanel.scanSuccess') : t('qrcodePanel.scanFailed'));
		setLoading(false);
	}, [showToast, t]);

	return (
		<div style={styles.wrapper}>
			<div style={styles.tabs}>
				<button style={{ ...styles.tab, ...(mode === 'generate' ? styles.tabActive : {}) }} onClick={() => setMode('generate')}>🔲 {t('qrcodePanel.generate')}</button>
				<button style={{ ...styles.tab, ...(mode === 'scan' ? styles.tabActive : {}) }} onClick={() => setMode('scan')}>📷 {t('qrcodePanel.scan')}</button>
			</div>

			{mode === 'generate' ? (
				<>
					<Card variant="default" padding="md">
						<textarea style={styles.textarea} placeholder={t('qrcodePanel.placeholder')} value={text} onChange={(e) => setText(e.target.value)} />
						<div style={styles.optionsRow}>
							<div style={styles.option}><label style={styles.label}>Dark</label><input type="color" style={styles.colorInput} value={options.darkColor} onChange={(e) => setOptions(p => ({ ...p, darkColor: e.target.value }))} /></div>
							<div style={styles.option}><label style={styles.label}>Light</label><input type="color" style={styles.colorInput} value={options.lightColor} onChange={(e) => setOptions(p => ({ ...p, lightColor: e.target.value }))} /></div>
							<div style={styles.option}><label style={styles.label}>Logo</label><div style={styles.logoBtn} onClick={() => logoInputRef.current?.click()}>{options.logo ? '✅' : '📁 Upload'}</div><input ref={logoInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoUpload} /></div>
							{options.logo && <div style={styles.option}><label style={styles.label}>Action</label><div style={{ ...styles.logoBtn, color: '#ef4444' }} onClick={() => setOptions(p => ({ ...p, logo: undefined }))}>✕ Remove</div></div>}
						</div>
						<button style={{ ...styles.btn, marginTop: '12px', width: '100%', opacity: loading || !text.trim() ? 0.6 : 1 }} onClick={handleGenerate} disabled={loading || !text.trim()}>{loading ? t('qrcodePanel.generating') : t('qrcodePanel.generate')}</button>
					</Card>
					{qrDataUrl && <div style={styles.qrContainer}><div style={styles.qrImage}><img src={qrDataUrl} alt="QR" width={180} height={180} /></div>
						<div style={styles.actionRow}><button style={styles.actionBtn} onClick={handleCopy}>📋 Copy</button><button style={styles.actionBtn} onClick={handleDownloadPNG}>🖼️ PNG</button><button style={styles.actionBtn} onClick={handleDownloadSVG}>📐 SVG</button></div></div>}
					{history.length > 0 && <div style={styles.historySection}><div style={styles.historyTitle}><span>{t('qrcodePanel.recent')}</span><span>{history.length}</span></div>
						<div style={styles.historyList}>{history.map((item, i) => <div key={i} style={styles.historyItem} onClick={() => setText(item)} title={item}>{item}</div>)}</div></div>}
				</>
			) : (
				<>
					<div style={styles.scanZone} onClick={() => fileInputRef.current?.click()}><span style={styles.scanIcon}>📷</span><p style={{ color: 'var(--halo-text-secondary)', fontSize: '13px' }}>{t('qrcodePanel.scanFromImage')}</p></div>
					<input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleScanFile} />
					<div style={styles.scanBtns}><button style={{ ...styles.btn, ...styles.btnSecondary, flex: 1 }} onClick={() => fileInputRef.current?.click()}>📁 Image</button><button style={{ ...styles.btn, ...styles.btnSecondary, flex: 1 }} onClick={handleScanClipboard}>📋 Clipboard</button></div>
					{scanResult && <div style={styles.resultCard}><div style={styles.resultLabel}>{t('qrcodePanel.detectedContent')}</div><div style={styles.resultText}>{scanResult.data}</div>
						<div style={{ ...styles.actionRow, marginTop: '12px' }}><button style={styles.actionBtn} onClick={() => { navigator.clipboard.writeText(scanResult.data); showToast(t('qrcodePanel.copied')); }}>📋 Copy</button>
							{/^https?:\/\//i.test(scanResult.data) && <button style={{ ...styles.actionBtn, background: 'var(--halo-accent)', color: '#fff', border: 'none' }} onClick={() => window.open(scanResult.data)}>🔗 Open</button>}</div></div>}
				</>
			)}
{/* Toast removed */}
		</div>
	);
};
