// goal: SRI panel UI

import type React from 'react';
import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from '../../i18n';
import { calculateSri, generateTag, type Algo } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';
import { useOwnedAsyncTask } from '../../kernel/hooks/use-owned-async-task';
import type { ToolStateCodec } from '../../kernel/core/storage-codec';
import { StorageRecoveryActions } from '../../components/sidepanel/StorageRecoveryActions';

const sriAlgorithmCodec: ToolStateCodec<Algo> = {
	decode: (value) => value === 'sha256' || value === 'sha384' || value === 'sha512'
		? { kind: 'valid', value } : { kind: 'invalid', reason: 'SRI algorithm is invalid.' },
	encode: (value) => value,
};


export const SriPanel: React.FC = () => {
    const { t } = useTranslation();
    const [url, setUrl] = useToolState<string>('subresource-url', '');
    const [content, setContent] = useToolState<string>('subresource-content', '');
    const [hashOnly, setHashOnly] = useState('');
    const [tag, setTag] = useState('');
	const [alg, setAlg, , algRecovery] = useToolState<Algo>('subresource-alg', 'sha384', { codec: sriAlgorithmCodec });

	const task = useOwnedAsyncTask();

    // Fetch content if URL is provided and user clicks fetch?
    // CORS might block it. Let's assume user pastes content OR we try fetch.
    // For simplicity: User pastes content mostly, or we try generic fetch.
    const handleFetch = useCallback(async () => {
        if (!url) return;
		const controller = new AbortController();
		const outcome = await task.run(() => ({
			promise: fetch(url, { signal: controller.signal }).then((response) => response.text()),
			dispose: () => controller.abort(),
		}));
		if (outcome.kind === 'succeeded') setContent(outcome.value);
		else if (outcome.kind === 'failed') {
            alert('Failed to fetch URL (CORS error?)');
        }
	}, [url, setContent, task.run]);

    // Recalculate when content or alg changes
    useEffect(() => {
        if (!content) {
            setHashOnly('');
            setTag('');
            return;
        }
		void task.run(() => calculateSri(content, alg)).then((outcome) => {
			if (outcome.kind !== 'succeeded') return;
			setHashOnly(outcome.value);
            if (url) {
                // Determine type by extension
                const type = url.endsWith('.css') ? 'link' : 'script';
				setTag(generateTag(url, outcome.value, type));
            } else {
                setTag('');
            }
		});
		return task.cancel;
	}, [content, alg, url, task.run, task.cancel]);

	return (
		<div style={styles.wrapper}>
			<StorageRecoveryActions recovery={algRecovery} emptyValue="sha384" exportName="halo-sri-algorithm-damaged.json" />
            <div>
                <div style={styles.label}>{t('subresource.url', { defaultValue: 'Resource URL' })} ({t('subresource.optional', { defaultValue: 'Optional' })})</div>
                <div style={{display: 'flex', gap: '8px'}}>
                    <input style={styles.input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('subresource.placeholderUrl', { defaultValue: 'https://cdn.example.com/lib.js' })} />
					<button type="button" style={styles.btn} onClick={handleFetch} disabled={!url || task.phase === 'running'}>
						{task.phase === 'running' ? '⏳' : `📥 ${t('subresource.fetch', { defaultValue: 'Fetch' })}`}
                    </button>
                </div>
            </div>

            <div>
                <div style={styles.label}>{t('subresource.pasteCode', { defaultValue: 'Content (Paste code here)' })}</div>
                <textarea
                    style={styles.textarea}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder={t('subresource.placeholderContent', { defaultValue: 'function() { ... }' })}
                />
            </div>

            <div style={styles.row}>
                <span style={styles.label}>{t('subresource.algorithm', { defaultValue: 'Algorithm' })}:</span>
                <div style={{ display: 'inline-flex', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--halo-border)', background: 'var(--halo-bg-tertiary)' }}>
                    {(['sha256', 'sha384', 'sha512'] as const).map((a) => (
                        <button
                            key={a}
                            type="button"
                            style={{
                                border: 'none',
                                background: alg === a ? 'var(--halo-accent)' : 'transparent',
                                color: alg === a ? '#fff' : 'var(--halo-text-muted)',
                                padding: '4px 10px', fontSize: '11px', fontWeight: 500, cursor: 'pointer', transition: 'var(--halo-motion-transition, all 0.15s)',
                            }}
                            onClick={() => setAlg(a)}
                        >
                            {a.toUpperCase().replace('SHA', 'SHA-')}
                        </button>
                    ))}
                </div>
            </div>

            {hashOnly && (
                <div>
                    <div style={styles.label}>{t('subresource.hash', { defaultValue: 'Integrity Hash' })}</div>
                    <button
                        type="button"
                        style={{ ...styles.resultBox, width: '100%', textAlign: 'left', cursor: 'pointer' }}
                        onClick={() => navigator.clipboard.writeText(hashOnly)}
                    >
                        {hashOnly}
                    </button>
                </div>
            )}

            {tag && (
                <div>
                    <div style={styles.label}>{t('subresource.tag', { defaultValue: 'HTML Tag' })}</div>
                    <button
                        type="button"
                        style={{ ...styles.resultBox, width: '100%', textAlign: 'left', cursor: 'pointer' }}
                        onClick={() => navigator.clipboard.writeText(tag)}
                    >
                        {tag}
                    </button>
                </div>
            )}
		</div>
	);
};
