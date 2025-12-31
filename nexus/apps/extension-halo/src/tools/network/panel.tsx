// goal: Network utility panel UI - UA Parser & Curl Converter

import React, { useState, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { NetworkMode, UAResult, CurlParseResult } from './types';
import { parseUserAgent, parseCurl, generateJS, generatePython } from './core';
import { styles } from './panel.styles';

const MODES: { id: NetworkMode; label: string }[] = [
	{ id: 'ua-parser', label: 'UA Parser' },
	{ id: 'curl-converter', label: 'Curl → Code' },
];

// UA Parser Sub-panel
const UAParserPanel: React.FC = () => {
	const { t } = useTranslation();
	const [ua, setUA] = useState(navigator.userAgent);
	const [result, setResult] = useState<UAResult | null>(null);

	const handleParse = useCallback(() => setResult(parseUserAgent(ua)), [ua]);
	const useCurrent = () => setUA(navigator.userAgent);

	return (
		<div style={styles.wrapper}>
			<div style={styles.row}>
				<span style={styles.label}>{t('network.ua.input')}</span>
				<button style={styles.btnSecondary} onClick={useCurrent}>{t('network.ua.current')}</button>
			</div>
			<textarea style={styles.textarea} value={ua} onChange={(e) => setUA(e.target.value)} placeholder="Mozilla/5.0..." />
			<button style={styles.btn} onClick={handleParse}>{t('network.ua.parse')}</button>
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
	const [curl, setCurl] = useState('');
	const [parsed, setParsed] = useState<CurlParseResult | null>(null);
	const [lang, setLang] = useState<'js' | 'python'>('js');

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
			<button style={styles.btn} onClick={handleParse}>{t('network.curl.convert')}</button>
			{parsed && (
				<Card variant="default" padding="sm">
					<div style={styles.row}>
						<button style={{ ...styles.btnSecondary, ...(lang === 'js' ? styles.active : {}) }} onClick={() => setLang('js')}>JavaScript</button>
						<button style={{ ...styles.btnSecondary, ...(lang === 'python' ? styles.active : {}) }} onClick={() => setLang('python')}>Python</button>
						<button style={{ ...styles.btnSecondary, marginLeft: 'auto' }} onClick={copyCode}>📋 {t('common.copy')}</button>
					</div>
					<pre style={styles.resultBox}>{lang === 'js' ? generateJS(parsed) : generatePython(parsed)}</pre>
				</Card>
			)}
		</div>
	);
};

// Main Network Panel
export const NetworkPanel: React.FC = () => {
	const [mode, setMode] = useState<NetworkMode>('ua-parser');

	return (
		<div style={styles.wrapper}>
			<Card variant="default" padding="sm">
				<div style={styles.tabs}>
					{MODES.map((m) => (
						<button key={m.id} style={{ ...styles.tab, ...(mode === m.id ? styles.active : styles.inactive) }} onClick={() => setMode(m.id)}>
							{m.label}
						</button>
					))}
				</div>
			</Card>
			{mode === 'ua-parser' && <UAParserPanel />}
			{mode === 'curl-converter' && <CurlConverterPanel />}
		</div>
	);
};
