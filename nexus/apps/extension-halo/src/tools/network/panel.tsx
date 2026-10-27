// goal: Network utility panel UI - UA Parser & Curl Converter

import type React from 'react';
import { useState, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { NetworkMode, UAResult, CurlParseResult } from './types';
import { parseUserAgent, parseCurl, generateJS, generatePython, curlLanguageCodec, networkModeCodec } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


const MODES: { id: NetworkMode; label: string }[] = [
	{ id: 'ua-parser', label: 'UA Parser' }, // Should use t() but inside component is better or assume these match locale keys if possible. But here dynamic is hard. Let's leave these or move to component body.
    // Actually, let's keep them as IDs and translate inside the component map loop
	{ id: 'curl-converter', label: 'Curl → Code' },
];

// UA Parser Sub-panel
const UAParserPanel: React.FC = () => {
	const { t } = useTranslation();
	const [ua, setUA] = useToolState<string>('network-ua-input', navigator.userAgent);

	const [result, setResult] = useState<UAResult | null>(null);

	const handleParse = useCallback(() => setResult(parseUserAgent(ua)), [ua]);
	const applyCurrentUA = () => setUA(navigator.userAgent);

	return (
		<div style={styles.wrapper}>
			<div style={styles.row}>
				<span style={styles.label}>{t('network.ua.input')}</span>
				<button type="button" style={styles.btnSecondary} onClick={applyCurrentUA}>{t('network.ua.current')}</button>
			</div>
			<textarea style={styles.textarea} value={ua} onChange={(e) => setUA(e.target.value)} placeholder="Mozilla/5.0..." />
			<button type="button" style={styles.btn} onClick={handleParse}>{t('network.ua.parse')}</button>
			{result && (
				<Card variant="default" padding="sm">
					<div style={styles.infoRow}><span style={styles.infoLabel}>{t('network.ua.browser')}</span><span style={styles.infoValue}>{result.browser.name} {result.browser.version}</span></div>
					<div style={styles.infoRow}><span style={styles.infoLabel}>{t('network.ua.os')}</span><span style={styles.infoValue}>{result.os.name} {result.os.version}</span></div>
					<div style={styles.infoRow}><span style={styles.infoLabel}>{t('network.ua.device')}</span><span style={styles.infoValue}>{result.device.type}</span></div>
					<div style={{ ...styles.infoRow, borderBottom: 'none' }}><span style={styles.infoLabel}>{t('network.ua.engine')}</span><span style={styles.infoValue}>{result.engine.name} {result.engine.version}</span></div>
				</Card>
			)}
		</div>
	);
};

// Curl Converter Sub-panel
const CurlConverterPanel: React.FC = () => {
	const { t } = useTranslation();
	const [curl, setCurl] = useToolState<string>('network-curl-input', '');
	const [parsed, setParsed] = useState<CurlParseResult | null>(null);
	const [lang, setLang] = useToolState<'js' | 'python'>('network-curl-lang', 'js', { codec: curlLanguageCodec });


	const handleParse = useCallback(() => setParsed(parseCurl(curl)), [curl]);
	const copyCode = () => {
		if (!parsed) return;
		const code = lang === 'js' ? generateJS(parsed) : generatePython(parsed);
		navigator.clipboard.writeText(code);
	};

	return (
		<div style={styles.wrapper}>
			<span style={styles.label}>{t('network.curl.input')}</span>
			<textarea style={styles.textarea} value={curl} onChange={(e) => setCurl(e.target.value)} placeholder="curl 'https://example.com' -H 'Authorization: Bearer token'" />
			<button type="button" style={styles.btn} onClick={handleParse}>{t('network.curl.convert')}</button>
			{parsed && (
				<Card variant="default" padding="sm">
					<div style={styles.row}>
						<button type="button" style={{ ...styles.btnSecondary, ...(lang === 'js' ? styles.active : {}) }} onClick={() => setLang('js')}>{t('network.langJs', {defaultValue: 'JavaScript'})}</button>
						<button type="button" style={{ ...styles.btnSecondary, ...(lang === 'python' ? styles.active : {}) }} onClick={() => setLang('python')}>{t('network.langPy', {defaultValue: 'Python'})}</button>
						<button type="button" style={{ ...styles.btnSecondary, marginLeft: 'auto' }} onClick={copyCode}>📋 {t('common.copy')}</button>
					</div>
					<pre style={styles.resultBox}>{lang === 'js' ? generateJS(parsed) : generatePython(parsed)}</pre>
				</Card>
			)}
		</div>
	);
};

// Main Network Panel
export const NetworkPanel: React.FC = () => {
    const { t } = useTranslation();
	const [mode, setMode] = useToolState<NetworkMode>('network-mode', 'ua-parser', { codec: networkModeCodec });


	return (
		<div style={styles.wrapper}>
			<Card variant="default" padding="sm">
				<div style={styles.tabs}>
					{MODES.map((m) => (
						<button type="button" key={m.id} style={{ ...styles.tab, ...(mode === m.id ? styles.active : styles.inactive) }} onClick={() => setMode(m.id)}>
							{m.id === 'ua-parser' ? t('network.modes.ua', {defaultValue: 'UA Parser'}) : t('network.modes.curl', {defaultValue: 'Curl → Code'})}
						</button>
					))}
				</div>
			</Card>
			{mode === 'ua-parser' && <UAParserPanel />}
			{mode === 'curl-converter' && <CurlConverterPanel />}
		</div>
	);
};
