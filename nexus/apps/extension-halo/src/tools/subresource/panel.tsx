// goal: SRI panel UI

import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from '../../i18n';
import { calculateSri, generateTag, type Algo } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const SriPanel: React.FC = () => {
    const { t } = useTranslation();
    const [url, setUrl] = useToolState<string>('subresource-url' as any, '');
    const [content, setContent] = useToolState<string>('subresource-content' as any, '');
    const [hashOnly, setHashOnly] = useState(''); 
    const [tag, setTag] = useState('');
    const [alg, setAlg] = useToolState<Algo>('subresource-alg' as any, 'sha384');

    const [loading, setLoading] = useState(false);

    // Fetch content if URL is provided and user clicks fetch?
    // CORS might block it. Let's assume user pastes content OR we try fetch.
    // For simplicity: User pastes content mostly, or we try generic fetch.
    const handleFetch = useCallback(async () => {
        if (!url) return;
        setLoading(true);
        try {
            const res = await fetch(url);
            const text = await res.text();
            setContent(text);
        } catch {
            alert('Failed to fetch URL (CORS error?)');
        }
        setLoading(false);
    }, [url]);

    // Recalculate when content or alg changes
    useEffect(() => {
        if (!content) {
            setHashOnly('');
            setTag('');
            return;
        }
        calculateSri(content, alg).then(h => {
            setHashOnly(h);
            if (url) {
                // Determine type by extension
                const type = url.endsWith('.css') ? 'link' : 'script';
                setTag(generateTag(url, h, type));
            } else {
                setTag('');
            }
        });
    }, [content, alg, url]);

	return (
		<div style={styles.wrapper}>
            <div>
                <div style={styles.label}>Resource URL (Optional)</div>
                <div style={{display: 'flex', gap: '8px'}}>
                    <input style={styles.input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://cdn.example.com/lib.js" />
                    <button style={styles.btn} onClick={handleFetch} disabled={!url || loading}>
                        {loading ? '⏳' : '📥 Fetch'}
                    </button>
                </div>
            </div>

            <div>
                <div style={styles.label}>Content (Paste code here)</div>
                <textarea 
                    style={styles.textarea} 
                    value={content} 
                    onChange={(e) => setContent(e.target.value)} 
                    placeholder="function() { ... }" 
                />
            </div>

            <div style={styles.row}>
                <span style={styles.label}>Algorithm:</span>
                <select style={styles.select} value={alg} onChange={(e) => setAlg(e.target.value as Algo)}>
                    <option value="sha256">SHA-256</option>
                    <option value="sha384">SHA-384</option>
                    <option value="sha512">SHA-512</option>
                </select>
            </div>

            {hashOnly && (
                <div>
                    <div style={styles.label}>Integrity Hash</div>
                    <div style={styles.resultBox} onClick={() => navigator.clipboard.writeText(hashOnly)}>
                        {hashOnly}
                    </div>
                </div>
            )}

            {tag && (
                <div>
                    <div style={styles.label}>HTML Tag</div>
                    <div style={styles.resultBox} onClick={() => navigator.clipboard.writeText(tag)}>
                        {tag}
                    </div>
                </div>
            )}
		</div>
	);
};
