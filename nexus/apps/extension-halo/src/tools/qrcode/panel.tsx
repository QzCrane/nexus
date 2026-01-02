// goal: QR Code tool panel UI with generate + scan + custom styles

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Card } from '@nexus/ui-kit';
import { createLogger } from '@nexus/kernel';
import { useTranslation } from '../../i18n';
import {
	generateQRCode,
	generateSVG,
	saveToHistory,
	loadHistory,
	downloadQRCode,
	copyImageToClipboard,
	scanQRCodeFromFile,
	scanQRCodeFromClipboard,
} from './core';
import type { ScanResult, QRCodeOptions } from './types';
import { DEFAULT_OPTIONS } from './types';

const logger = createLogger('QRCode', 'HALO');

type TabMode = 'generate' | 'scan';

const styles: Record<string, React.CSSProperties> = {
	wrapper: { display: 'flex', flexDirection: 'column', gap: '12px' },
	tabs: { display: 'flex', gap: '4px', background: 'var(--halo-bg-secondary)', borderRadius: '10px', padding: '4px' },
	tab: { flex: 1, padding: '10px', border: 'none', borderRadius: '8px', background: 'transparent', color: 'var(--halo-text-secondary)', fontSize: '12px', fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s' },
	tabActive: { background: 'var(--halo-accent)', color: '#fff' },
	textarea: { width: '100%', minHeight: '60px', padding: '12px', border: '1px solid var(--halo-border)', borderRadius: '10px', background: 'var(--halo-bg-secondary)', color: 'var(--halo-text)', fontSize: '13px', resize: 'vertical', fontFamily: 'inherit', outline: 'none' },
	optionsRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '10px' },
	option: { display: 'flex', flexDirection: 'column', gap: '4px' },
	label: { fontSize: '10px', color: 'var(--halo-text-muted)', textTransform: 'uppercase' },
	colorInput: { width: '100%', height: '30px', border: '1px solid var(--halo-border)', borderRadius: '6px', cursor: 'pointer', background: 'transparent', padding: 0 },
	logoInput: { display: 'none' },
	logoBtn: { padding: '6px', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', borderRadius: '6px', fontSize: '11px', color: 'var(--halo-text-secondary)', cursor: 'pointer', textAlign: 'center' },
	btn: { padding: '12px 18px', background: 'linear-gradient(135deg, var(--halo-accent), #4a9eff)', border: 'none', borderRadius: '10px', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' },
	btnSecondary: { background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', color: 'var(--halo-text-secondary)', fontWeight: 500 },
	qrContainer: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', padding: '20px', background: 'var(--halo-bg-secondary)', borderRadius: '12px' },
	qrImage: { padding: '14px', background: 'var(--white, #fff)', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' },
	actionRow: { display: 'flex', gap: '10px', width: '100%' },
	actionBtn: { flex: 1, padding: '10px', background: 'var(--halo-bg-tertiary)', border: '1px solid var(--halo-border)', borderRadius: '10px', color: 'var(--halo-text-secondary)', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' },
	historySection: { marginTop: '8px' },
	historyTitle: { fontSize: '11px', color: 'var(--halo-text-muted)', marginBottom: '8px', display: 'flex', justifyContent: 'space-between' },
	historyList: { display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '100px', overflowY: 'auto', paddingRight: '4px' },
	historyItem: { padding: '8px 12px', background: 'var(--halo-bg-secondary)', borderRadius: '8px', fontSize: '11px', color: 'var(--halo-text-secondary)', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: '1px solid transparent' },
	scanZone: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '40px 20px', background: 'var(--halo-bg-secondary)', borderRadius: '12px', border: '2px dashed var(--halo-border)', textAlign: 'center', cursor: 'pointer' },
	scanIcon: { fontSize: '48px', opacity: 0.5 },
	scanBtns: { display: 'flex', gap: '10px' },
	resultCard: { padding: '16px', background: 'var(--halo-bg-secondary)', borderRadius: '12px', border: '1px solid var(--halo-accent)' },
	resultLabel: { fontSize: '10px', color: 'var(--halo-text-muted)', marginBottom: '8px', textTransform: 'uppercase' },
	resultText: { fontSize: '13px', color: 'var(--halo-text)', wordBreak: 'break-all', lineHeight: 1.5 },
	toast: { position: 'fixed', bottom: '60px', left: '50%', transform: 'translateX(-50%)', padding: '10px 20px', background: 'var(--halo-accent)', borderRadius: '24px', fontSize: '12px', fontWeight: 500, color: '#fff', zIndex: 1000, animation: 'fadeInUp 0.3s ease-out' },
};

export const QRCodePanel: React.FC = () => {
	const { t } = useTranslation();
	const [mode, setMode] = useState<TabMode>('generate');
	const [text, setText] = useState('');
	const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
	const [options, setOptions] = useState<Omit<QRCodeOptions, 'text'>>(DEFAULT_OPTIONS);
	const [loading, setLoading] = useState(false);
	const [history, setHistory] = useState<string[]>([]);
	const [scanResult, setScanResult] = useState<ScanResult | null>(null);
	const [toast, setToast] = useState<string | null>(null);
	
	const fileInputRef = useRef<HTMLInputElement>(null);
	const logoInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => { loadHistory().then(setHistory); }, []);

	const showToast = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2000); }, []);

	const handleGenerate = useCallback(async () => {
		if (!text.trim()) return;
		setLoading(true);
		try {
			const dataUrl = await generateQRCode(text.trim(), options);
			setQrDataUrl(dataUrl);
			const updated = await saveToHistory(text.trim());
			setHistory(updated);
		} catch (e) { 
			logger.error('QR Generate failed', e);
			showToast(t('qrcodePanel.failed')); 
		}
		finally { setLoading(false); }
	}, [text, options, showToast, t]);

	const handleKeyDown = useCallback((e: React.KeyboardEvent) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleGenerate(); }, [handleGenerate]);

	const handleCopy = useCallback(async () => { if (qrDataUrl && await copyImageToClipboard(qrDataUrl)) showToast(t('qrcodePanel.copied')); }, [qrDataUrl, showToast, t]);

	const handleDownloadPNG = useCallback(async () => {
		if (!qrDataUrl) return;
		const res = await fetch(qrDataUrl);
		const blob = await res.blob();
		downloadQRCode(blob, `qr-${Date.now()}.png`);
		showToast(t('qrcodePanel.downloaded'));
	}, [qrDataUrl, showToast, t]);

	const handleDownloadSVG = useCallback(async () => {
		if (!text.trim()) return;
		const svg = await generateSVG(text.trim(), options);
		const blob = new Blob([svg], { type: 'image/svg+xml' });
		downloadQRCode(blob, `qr-${Date.now()}.svg`);
		showToast(t('qrcodePanel.downloaded'));
	}, [text, options, showToast, t]);

	const handleLogoUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = (ev) => {
			setOptions(prev => ({ ...prev, logo: ev.target?.result as string }));
		};
		reader.readAsDataURL(file);
	}, []);

	const handleScanFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		setLoading(true);
		const result = await scanQRCodeFromFile(file);
		setScanResult(result);
		showToast(result ? t('qrcodePanel.scanSuccess') : t('qrcodePanel.scanFailed'));
		setLoading(false);
		e.target.value = '';
	}, [showToast, t]);

	const handleScanClipboard = useCallback(async () => {
		setLoading(true);
		const result = await scanQRCodeFromClipboard();
		setScanResult(result);
		showToast(result ? t('qrcodePanel.scanSuccess') : t('qrcodePanel.scanFailed'));
		setLoading(false);
	}, [showToast, t]);

	const handleCopyResult = useCallback(async () => {
		if (scanResult?.data) { await navigator.clipboard.writeText(scanResult.data); showToast(t('qrcodePanel.copied')); }
	}, [scanResult, showToast, t]);

	const handleOpenLink = useCallback(() => {
		if (scanResult?.data) { try { const url = new URL(scanResult.data); chrome.tabs.create({ url: url.href }); } catch { /* not a URL */ } }
	}, [scanResult]);

	const isUrl = scanResult?.data ? /^https?:\/\//i.test(scanResult.data) : false;

	return (
		<div style={styles.wrapper}>
			<div style={styles.tabs}>
				<button style={{ ...styles.tab, ...(mode === 'generate' ? styles.tabActive : {}) }} onClick={() => setMode('generate')}>🔲 {t('qrcodePanel.generate')}</button>
				<button style={{ ...styles.tab, ...(mode === 'scan' ? styles.tabActive : {}) }} onClick={() => setMode('scan')}>📷 {t('qrcodePanel.scan')}</button>
			</div>

			{mode === 'generate' ? (
				<>
					<Card variant="default" padding="md">
						<textarea style={styles.textarea} placeholder={t('qrcodePanel.placeholder')} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={handleKeyDown} />
						
						<div style={styles.optionsRow}>
							<div style={styles.option}>
								<label style={styles.label}>{t('colorPanel.hex')} (Dark)</label>
								<input type="color" style={styles.colorInput} value={options.darkColor} onChange={(e) => setOptions(prev => ({ ...prev, darkColor: e.target.value }))} />
							</div>
							<div style={styles.option}>
								<label style={styles.label}>{t('colorPanel.hex')} (Light)</label>
								<input type="color" style={styles.colorInput} value={options.lightColor} onChange={(e) => setOptions(prev => ({ ...prev, lightColor: e.target.value }))} />
							</div>
							<div style={styles.option}>
								<label style={styles.label}>Logo</label>
								<div style={styles.logoBtn} onClick={() => logoInputRef.current?.click()}>
									{options.logo ? '✅ Uploaded' : '📁 Upload Logo'}
								</div>
								<input ref={logoInputRef} type="file" accept="image/*" style={styles.logoInput} onChange={handleLogoUpload} />
							</div>
							{options.logo && (
								<div style={styles.option}>
									<label style={styles.label}>Action</label>
									<div style={{ ...styles.logoBtn, color: '#ef4444' }} onClick={() => setOptions(prev => ({ ...prev, logo: undefined }))}>✕ Remove Logo</div>
								</div>
							)}
						</div>

						<button style={{ ...styles.btn, marginTop: '12px', width: '100%', opacity: loading || !text.trim() ? 0.6 : 1 }} onClick={handleGenerate} disabled={loading || !text.trim()}>
							{loading ? t('qrcodePanel.generating') : t('qrcodePanel.generate')}
						</button>
					</Card>

					{qrDataUrl && (
						<div style={styles.qrContainer}>
							<div style={styles.qrImage}>
								<img src={qrDataUrl} alt="QR" width={180} height={180} />
							</div>
							<div style={styles.actionRow}>
								<button style={styles.actionBtn} onClick={handleCopy}>📋 Copy</button>
								<button style={styles.actionBtn} onClick={handleDownloadPNG}>🖼️ PNG</button>
								<button style={styles.actionBtn} onClick={handleDownloadSVG}>📐 SVG</button>
							</div>
						</div>
					)}
					
					{history.length > 0 && (
						<div style={styles.historySection}>
							<div style={styles.historyTitle}><span>{t('qrcodePanel.recent')}</span><span>{history.length}</span></div>
							<div style={styles.historyList}>{history.map((item, i) => <div key={i} style={styles.historyItem} onClick={() => setText(item)} title={item}>{item}</div>)}</div>
						</div>
					)}
				</>
			) : (
				<>
					<div style={styles.scanZone} onClick={() => fileInputRef.current?.click()}>
						<span style={styles.scanIcon}>📷</span>
						<p style={{ color: 'var(--halo-text-secondary)', fontSize: '13px' }}>{t('qrcodePanel.scanFromImage')}</p>
					</div>
					<input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleScanFile} />
					<div style={styles.scanBtns}>
						<button style={{ ...styles.btn, ...styles.btnSecondary, flex: 1 }} onClick={() => fileInputRef.current?.click()}>📁 Image</button>
						<button style={{ ...styles.btn, ...styles.btnSecondary, flex: 1 }} onClick={handleScanClipboard}>📋 Clipboard</button>
					</div>
					{scanResult && (
						<div style={styles.resultCard}>
							<div style={styles.resultLabel}>{t('qrcodePanel.detectedContent')}</div>
							<div style={styles.resultText}>{scanResult.data}</div>
							<div style={{ ...styles.actionRow, marginTop: '12px' }}>
								<button style={styles.actionBtn} onClick={handleCopyResult}>📋 Copy</button>
								{isUrl && <button style={{ ...styles.actionBtn, background: 'var(--halo-accent)', color: '#fff', border: 'none' }} onClick={handleOpenLink}>🔗 Open</button>}
							</div>
						</div>
					)}
				</>
			)}
			{toast && <div style={styles.toast}>{toast}</div>}
		</div>
	);
};
