// goal: QR Code tool panel UI with generate + scan

import type React from 'react';
import { useState, useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { Card } from '@nexus/ui-kit';
import { createLogger } from '@nexus/kernel';
import { useTranslation } from '../../i18n';
import { generateQRCode, generateSVG, qrcodeOptionsCodec } from './core';
import { saveToHistory, loadHistory, downloadQRCode, copyImageToClipboard } from './utils';
import { scanQRCodeFromFile, scanQRCodeFromClipboard } from './scan';
import type { ScanResult, QRCodeOptions } from './types';
import { DEFAULT_OPTIONS } from './types';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';
import { useOwnedAsyncTask } from '../../kernel/hooks/use-owned-async-task';
import type { OwnedTaskExecution } from '../../kernel/utils/owned-async-task';
import type { ToolStateCodec } from '../../kernel/core/storage-codec';
import { StorageRecoveryActions } from '../../components/sidepanel/StorageRecoveryActions';
import {
	acknowledgeSidepanelActivation,
	getSidepanelActivationSnapshot,
	persistQrcodeActivation,
	subscribeSidepanelActivation,
} from '../../kernel/core/sidepanel-activation-store';


import { useToast } from '../../components/ToastProvider';


const logger = createLogger('QRCode', 'HALO');
type TabMode = 'generate' | 'scan';
const qrcodeModeCodec: ToolStateCodec<TabMode> = {
	decode: (value) => value === 'generate' || value === 'scan' ? { kind: 'valid', value } : { kind: 'invalid', reason: 'QR mode is invalid.' },
	encode: (value) => value,
};

function readDataUrl(file: File): OwnedTaskExecution<string> {
	const reader = new FileReader();
	const promise = new Promise<string>((resolve, reject) => {
		reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Logo read returned no data URL'));
		reader.onerror = () => reject(reader.error ?? new Error('Logo read failed'));
		reader.readAsDataURL(file);
	});
	return { promise, dispose: () => { if (reader.readyState === FileReader.LOADING) reader.abort(); } };
}

export const QRCodePanel: React.FC = () => {
	const { t } = useTranslation();
    const { showToast } = useToast();
	const [mode, setMode, , modeRecovery] = useToolState<TabMode>('qrcode-mode', 'generate', { codec: qrcodeModeCodec });
	const [text, setText] = useToolState<string>('qrcode', '');
	const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
	const [options, setOptions, , optionsRecovery] = useToolState<Omit<QRCodeOptions, 'text'>>('qrcode-opts', DEFAULT_OPTIONS, { codec: qrcodeOptionsCodec });
	const task = useOwnedAsyncTask();
	const activationTask = useOwnedAsyncTask();
	const activation = useSyncExternalStore(
		subscribeSidepanelActivation,
		getSidepanelActivationSnapshot,
		getSidepanelActivationSnapshot,
	);

	const [history, setHistory] = useState<string[]>([]);
	const [scanResult, setScanResult] = useState<ScanResult | null>(null);
	// const [toast, setToast] = useState<string | null>(null); // Removed locally
	
	const fileInputRef = useRef<HTMLInputElement>(null);
	const logoInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		void task.run(() => loadHistory()).then((outcome) => {
			if (outcome.kind === 'succeeded') setHistory(outcome.value);
		});
		return task.cancel;
	}, [task.run, task.cancel]);
	useEffect(() => {
		const activationPayload = activation?.activation;
		if (activationPayload?.toolId !== 'qrcode' || !activation) return;
		const qrcodeActivation = activation;
		const activationText = activationPayload.payload.text;
		void activationTask.run(async () => {
			if (!await persistQrcodeActivation(qrcodeActivation)) return false;
			await acknowledgeSidepanelActivation(qrcodeActivation.id);
			return true;
		}).then((outcome) => {
			if (outcome.kind !== 'succeeded' || !outcome.value) return;
			setMode('generate');
			setText(activationText);
		});
		return activationTask.cancel;
	}, [activation, activationTask.run, activationTask.cancel, setMode, setText]);
	// const showToast = ... // Removed local implementation

	const handleGenerate = useCallback(async () => {
		if (!text.trim()) return;
		const outcome = await task.run(async () => {
			const dataUrl = await generateQRCode(text.trim(), options);
			return { dataUrl, history: await saveToHistory(text.trim()) };
		});
		if (outcome.kind === 'succeeded') { setQrDataUrl(outcome.value.dataUrl); setHistory(outcome.value.history); }
		else if (outcome.kind === 'failed') { logger.error('QR Generate failed', outcome.error); showToast(t('qrcodePanel.failed')); }
	}, [text, options, showToast, t, task.run]);

	const handleCopy = useCallback(async () => {
		if (!qrDataUrl) return;
		const outcome = await task.run(() => copyImageToClipboard(qrDataUrl));
		if (outcome.kind === 'succeeded' && outcome.value) showToast(t('qrcodePanel.copied'));
		else if (outcome.kind === 'succeeded') showToast(t('qrcodePanel.failed'));
	}, [qrDataUrl, showToast, t, task.run]);

	const handleDownloadPNG = useCallback(async () => {
		if (!qrDataUrl) return;
		const controller = new AbortController();
		const outcome = await task.run(() => ({
			promise: fetch(qrDataUrl, { signal: controller.signal }).then((response) => response.blob()),
			dispose: () => controller.abort(),
		}));
		if (outcome.kind === 'succeeded') { downloadQRCode(outcome.value, `qr-${Date.now()}.png`); showToast(t('qrcodePanel.downloaded')); }
	}, [qrDataUrl, showToast, t, task.run]);

	const handleDownloadSVG = useCallback(async () => {
		if (!text.trim()) return;
		const outcome = await task.run(() => generateSVG(text.trim(), options));
		if (outcome.kind === 'succeeded') { downloadQRCode(new Blob([outcome.value], { type: 'image/svg+xml' }), `qr-${Date.now()}.svg`); showToast(t('qrcodePanel.downloaded')); }
	}, [text, options, showToast, t, task.run]);

	const handleLogoUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		void task.run(() => readDataUrl(file)).then((outcome) => {
			if (outcome.kind === 'succeeded') setOptions((prev) => ({ ...prev, logo: outcome.value }));
		});
	}, [setOptions, task.run]);

	const handleScanFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		const input = e.currentTarget;
		const controller = new AbortController();
		const outcome = await task.run(() => ({ promise: scanQRCodeFromFile(file, controller.signal), dispose: () => controller.abort() }));
		if (outcome.kind === 'succeeded') {
			setScanResult(outcome.value);
			showToast(outcome.value ? t('qrcodePanel.scanSuccess') : t('qrcodePanel.scanFailed'));
		}
		input.value = '';
	}, [showToast, t, task.run]);

	const handleScanClipboard = useCallback(async () => {
		const controller = new AbortController();
		const outcome = await task.run(() => ({ promise: scanQRCodeFromClipboard(controller.signal), dispose: () => controller.abort() }));
		if (outcome.kind === 'succeeded') {
			setScanResult(outcome.value);
			showToast(outcome.value ? t('qrcodePanel.scanSuccess') : t('qrcodePanel.scanFailed'));
		}
	}, [showToast, t, task.run]);

	return (
		<div style={styles.wrapper}>
			<StorageRecoveryActions recovery={modeRecovery} emptyValue="generate" exportName="halo-qrcode-mode-damaged.json" />
			<StorageRecoveryActions recovery={optionsRecovery} emptyValue={DEFAULT_OPTIONS} exportName="halo-qrcode-options-damaged.json" />
			<div style={styles.tabs}>
				<button type="button" style={{ ...styles.tab, ...(mode === 'generate' ? styles.tabActive : {}) }} onClick={() => setMode('generate')}>🔲 {t('qrcodePanel.generate')}</button>
				<button type="button" style={{ ...styles.tab, ...(mode === 'scan' ? styles.tabActive : {}) }} onClick={() => setMode('scan')}>📷 {t('qrcodePanel.scan')}</button>
			</div>

			{mode === 'generate' ? (
				<>
					<Card variant="default" padding="md">
						<textarea style={styles.textarea} placeholder={t('qrcodePanel.placeholder')} value={text} onChange={(e) => setText(e.target.value)} />
						<div style={styles.optionsRow}>
							<div style={styles.option}><label htmlFor="qrcode-dark-color" style={styles.label}>{t('qrcodePanel.labelDark', { defaultValue: 'Dark' })}</label><input id="qrcode-dark-color" type="color" style={styles.colorInput} value={options.darkColor} onChange={(e) => setOptions(p => ({ ...p, darkColor: e.target.value }))} /></div>
							<div style={styles.option}><label htmlFor="qrcode-light-color" style={styles.label}>{t('qrcodePanel.labelLight', { defaultValue: 'Light' })}</label><input id="qrcode-light-color" type="color" style={styles.colorInput} value={options.lightColor} onChange={(e) => setOptions(p => ({ ...p, lightColor: e.target.value }))} /></div>
							<div style={styles.option}><div style={styles.label}>{t('qrcodePanel.labelLogo', { defaultValue: 'Logo' })}</div><label htmlFor="qrcode-logo-upload" style={styles.logoBtn}>{options.logo ? '✅' : `📁 ${t('qrcodePanel.upload', { defaultValue: 'Upload' })}`}</label><input id="qrcode-logo-upload" ref={logoInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoUpload} /></div>
							{options.logo && <div style={styles.option}><div style={styles.label}>{t('qrcodePanel.labelAction', { defaultValue: 'Action' })}</div><button type="button" style={{ ...styles.logoBtn, color: '#ef4444' }} onClick={() => setOptions(p => ({ ...p, logo: undefined }))}>✕ {t('qrcodePanel.remove', { defaultValue: 'Remove' })}</button></div>}
						</div>
						<button type="button" style={{ ...styles.btn, marginTop: '12px', width: '100%', opacity: task.phase === 'running' || !text.trim() ? 0.6 : 1 }} onClick={handleGenerate} disabled={task.phase === 'running' || !text.trim()}>{task.phase === 'running' ? t('qrcodePanel.generating') : t('qrcodePanel.generate')}</button>
					</Card>
					{qrDataUrl && <div style={styles.qrContainer}><div style={styles.qrImage}><img src={qrDataUrl} alt="QR" width={180} height={180} /></div>
						<div style={styles.actionRow}><button type="button" style={styles.actionBtn} onClick={handleCopy}>📋 {t('qrcodePanel.copy', { defaultValue: 'Copy' })}</button><button type="button" style={styles.actionBtn} onClick={handleDownloadPNG}>🖼️ PNG</button><button type="button" style={styles.actionBtn} onClick={handleDownloadSVG}>📐 SVG</button></div></div>}
					{history.length > 0 && <div style={styles.historySection}><div style={styles.historyTitle}><span>{t('qrcodePanel.recent')}</span><span>{history.length}</span></div>
						<div style={styles.historyList}>{history.map((item) => <button type="button" key={item} style={{ ...styles.historyItem, width: '100%', textAlign: 'left' }} onClick={() => setText(item)} title={item}>{item}</button>)}</div></div>}
				</>
			) : (
				<>
					<button type="button" style={{ ...styles.scanZone, width: '100%' }} onClick={() => fileInputRef.current?.click()}><span style={styles.scanIcon}>📷</span><span style={{ color: 'var(--halo-text-secondary)', fontSize: '13px' }}>{t('qrcodePanel.scanFromImage')}</span></button>
					<input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleScanFile} />
					<div style={styles.scanBtns}><button type="button" style={{ ...styles.btn, ...styles.btnSecondary, flex: 1 }} onClick={() => fileInputRef.current?.click()}>📁 {t('qrcodePanel.btnImage', { defaultValue: 'Image' })}</button><button type="button" style={{ ...styles.btn, ...styles.btnSecondary, flex: 1 }} onClick={handleScanClipboard}>📋 {t('qrcodePanel.btnClipboard', { defaultValue: 'Clipboard' })}</button></div>
					{scanResult && <div style={styles.resultCard}><div style={styles.resultLabel}>{t('qrcodePanel.detectedContent')}</div><div style={styles.resultText}>{scanResult.data}</div>
						<div style={{ ...styles.actionRow, marginTop: '12px' }}><button type="button" style={styles.actionBtn} onClick={() => { navigator.clipboard.writeText(scanResult.data); showToast(t('qrcodePanel.copied')); }}>📋 {t('qrcodePanel.copy', { defaultValue: 'Copy' })}</button>
							{/^https?:\/\//i.test(scanResult.data) && <button type="button" style={{ ...styles.actionBtn, background: 'var(--halo-accent)', color: '#fff', border: 'none' }} onClick={() => window.open(scanResult.data)}>🔗 Open</button>}</div></div>}
				</>
			)}
			{task.error !== null && <div role="alert" style={{ color: 'var(--halo-danger, #d33)', fontSize: '12px' }}>{String(task.error)}</div>}
{/* Toast removed */}
		</div>
	);
};
