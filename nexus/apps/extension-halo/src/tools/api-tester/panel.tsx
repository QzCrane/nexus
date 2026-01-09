// goal: API Tester panel UI - send HTTP requests and view responses

import React, { useState, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import type { HttpMethod, RequestConfig, ResponseData, Header } from './types';
import { executeRequest, formatBody, formatSize, createHeader, DEFAULT_CONFIG } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export const ApiTesterPanel: React.FC = () => {
	const { t } = useTranslation();
	const [config, setConfig] = useToolState<RequestConfig>('api-tester-config' as any, { ...DEFAULT_CONFIG });
	const [response, setResponse] = useToolState<ResponseData | null>('api-tester-res' as any, null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string>('');
	const [activeTab, setActiveTab] = useToolState<'headers' | 'body'>('api-tester-tab' as any, 'headers');


	// Send request
	const handleSend = useCallback(async () => {
		if (!config.url.trim()) return;
		setLoading(true);
		setError('');
		setResponse(null);
		try {
			const url = config.url.startsWith('http') ? config.url : `https://${config.url}`;
			const res = await executeRequest({ ...config, url });
			setResponse(res);
		} catch (err) {
			setError(err instanceof Error ? err.message : t('apiTester.error', { defaultValue: 'Request failed' }));
		} finally {
			setLoading(false);
		}
	}, [config]);

	// Update header
	const updateHeader = (idx: number, field: keyof Header, value: string | boolean) => {
		setConfig((c) => {
			const headers = [...c.headers];
			headers[idx] = { ...headers[idx]!, [field]: value };
			// Auto-add new row if last row filled
			if (idx === headers.length - 1 && headers[idx]!.key) headers.push(createHeader());
			return { ...c, headers };
		});
	};

	// Remove header
	const removeHeader = (idx: number) => {
		setConfig((c) => ({ ...c, headers: c.headers.filter((_, i) => i !== idx) }));
	};

	return (
		<div style={styles.wrapper}>
			{/* URL Row */}
			<div style={styles.urlRow}>
				<select style={styles.methodSelect} value={config.method} onChange={(e) => setConfig((c) => ({ ...c, method: e.target.value as HttpMethod }))}>
					{METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
				</select>
				<input
					style={styles.urlInput}
					placeholder={t('apiTester.urlPlaceholder', { defaultValue: 'https://api.example.com/endpoint' })}
					value={config.url}
					onChange={(e) => setConfig((c) => ({ ...c, url: e.target.value }))}
					onKeyDown={(e) => e.key === 'Enter' && handleSend()}
				/>
				<button style={styles.btn} onClick={handleSend} disabled={loading}>
					{loading ? '⏳' : '🚀'} {t('apiTester.send', { defaultValue: 'Send' })}
				</button>
			</div>

			{/* Tabs */}
			<div style={styles.tabs}>
				<button style={{ ...styles.tab, ...(activeTab === 'headers' ? styles.tabActive : {}) }} onClick={() => setActiveTab('headers')}>
					{t('apiTester.headers', { defaultValue: 'Headers' })}
				</button>
				<button style={{ ...styles.tab, ...(activeTab === 'body' ? styles.tabActive : {}) }} onClick={() => setActiveTab('body')}>
					{t('apiTester.body', { defaultValue: 'Body' })}
				</button>
			</div>

			{/* Headers Tab */}
			{activeTab === 'headers' && (
				<div style={styles.section}>
					{config.headers.map((h, idx) => (
						<div key={idx} style={{ ...styles.headerRow, marginBottom: '6px' }}>
							<input type="checkbox" checked={h.enabled} onChange={(e) => updateHeader(idx, 'enabled', e.target.checked)} />
							<input style={styles.headerInput} placeholder={t('apiTester.key', { defaultValue: 'Key' })} value={h.key} onChange={(e) => updateHeader(idx, 'key', e.target.value)} />
							<input style={styles.headerInput} placeholder={t('apiTester.value', { defaultValue: 'Value' })} value={h.value} onChange={(e) => updateHeader(idx, 'value', e.target.value)} />
							{config.headers.length > 1 && <button style={styles.btnSecondary} onClick={() => removeHeader(idx)}>×</button>}
						</div>
					))}
				</div>
			)}

			{/* Body Tab */}
			{activeTab === 'body' && (
				<div style={styles.section}>
					<div style={{ marginBottom: '8px' }}>
						<select style={styles.methodSelect} value={config.bodyType} onChange={(e) => setConfig((c) => ({ ...c, bodyType: e.target.value as RequestConfig['bodyType'] }))}>
							<option value="none">{t('apiTester.none', { defaultValue: 'None' })}</option>
							<option value="json">{t('apiTester.json', { defaultValue: 'JSON' })}</option>
							<option value="form">{t('apiTester.form', { defaultValue: 'Form' })}</option>
							<option value="text">{t('apiTester.text', { defaultValue: 'Text' })}</option>
						</select>
					</div>
					{config.bodyType !== 'none' && (
						<textarea
							style={styles.bodyArea}
							placeholder={config.bodyType === 'json' ? t('apiTester.bodyJsonPlaceholder', { defaultValue:'{"key": "value"}' }) : t('apiTester.bodyPlaceholder', { defaultValue: 'Request body...' })}
							value={config.body}
							onChange={(e) => setConfig((c) => ({ ...c, body: e.target.value }))}
						/>
					)}
				</div>
			)}

			{/* Error */}
			{error && <div style={{ color: '#ef4444', fontSize: '13px' }}>❌ {error}</div>}

			{/* Response */}
			{response && (
				<div style={styles.response}>
					<div style={styles.responseHeader}>
						<span style={{ ...styles.statusBadge, ...(response.status < 400 ? styles.statusOk : styles.statusError) }}>
							{response.status} {response.statusText}
						</span>
						<div style={styles.meta}>
							<span>⏱️ {t('apiTester.time', { defaultValue: 'Time' })}: {response.time}ms</span>
							<span>📦 {t('apiTester.size', { defaultValue: 'Size' })}: {formatSize(response.size)}</span>
						</div>
					</div>
					<pre style={styles.responseBody}>{formatBody(response.body)}</pre>
				</div>
			)}
		</div>
	);
};
