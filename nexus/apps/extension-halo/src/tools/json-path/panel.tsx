// goal: RFC 9535 JSONPath panel with owned, bounded worker execution

import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../../i18n';
import { useOwnedAsyncTask } from '../../kernel/hooks/use-owned-async-task';
import { extensionWorkerFactory, oneShotWorker } from '../../kernel/utils/one-shot-worker';
import { useToolState } from '../../kernel';
import { EXAMPLE_PATHS } from './core';
import { styles } from './panel.styles';
import { JSON_PATH_DEADLINE_MS, JSON_PATH_WORKER_PATH, type JsonPathResponse } from './worker-contract';

export const JsonPathPanel: React.FC = () => {
	const { t } = useTranslation();
	const [json, setJson] = useToolState<string>('json-path-input', '');
	const [path, setPath] = useToolState<string>('json-path-query', '$');
	const [response, setResponse] = useState<JsonPathResponse | null>(null);
	const { phase, run, cancel } = useOwnedAsyncTask();
	const createWorker = useMemo(() => extensionWorkerFactory(JSON_PATH_WORKER_PATH), []);

	useEffect(() => {
		if (!json.trim()) { cancel(); setResponse(null); return; }
		const timer = setTimeout(() => {
			void run(() => oneShotWorker(createWorker, { json, expression: path }), JSON_PATH_DEADLINE_MS).then((outcome) => {
				if (outcome.kind === 'succeeded') setResponse(outcome.value as JsonPathResponse);
				else if (outcome.kind === 'failed') setResponse({ ok: false, kind: 'execution', message: String(outcome.error) });
				else if (outcome.reason === 'deadline') setResponse({ ok: false, kind: 'budget', message: 'JSONPath execution exceeded 5 seconds' });
			});
		}, 150);
		return () => { clearTimeout(timer); cancel(); };
	}, [cancel, createWorker, json, path, run]);

	const results = response?.ok ? response.results : [];
	const handleCopy = useCallback(() => { void navigator.clipboard.writeText(JSON.stringify(results, null, 2)); }, [results]);
	return <div style={styles.wrapper}>
		<div style={styles.boundary}>{t('jsonPath.boundary')}</div>
		<div><div style={styles.label}>{t('jsonPath.input')}</div><textarea style={styles.textarea} value={json} onChange={(event) => setJson(event.target.value)} placeholder='{"users":[{"name":"John"}]}' /></div>
		<div><div style={styles.label}>{t('jsonPath.query')}</div><input style={styles.input} value={path} onChange={(event) => setPath(event.target.value)} placeholder="$.users[*].name" /></div>
		<div style={styles.examples}>{EXAMPLE_PATHS.map((example) => <button type="button" key={example} style={styles.example} onClick={() => setPath(example)}>{example}</button>)}</div>
		{phase === 'running' && <div style={styles.status}>{t('jsonPath.running')}</div>}
		{response && !response.ok && <div style={styles.error}>❌ {t(`jsonPath.${response.kind}`)}: {response.message}</div>}
		{response?.ok && <div style={styles.result}>
			<div style={styles.count}>{response.results.length} {t('jsonPath.matches')}</div>
			{response.results.length === 0 && <div style={styles.status}>{t('jsonPath.noMatches')}</div>}
			<pre style={styles.pre}>{JSON.stringify(response.results, null, 2)}</pre>
			<button type="button" style={{ marginTop: '8px', ...styles.example }} onClick={handleCopy}>📋 {t('jsonPath.copy')}</button>
		</div>}
	</div>;
};
