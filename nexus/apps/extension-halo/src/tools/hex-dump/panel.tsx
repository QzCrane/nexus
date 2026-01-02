// goal: Hex Dump panel UI

import React, { useState, useCallback, useRef } from 'react';
import { useTranslation } from '../../i18n';
import { createHexDump, type HexChunk } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';




export const HexDumpPanel: React.FC = () => {
	const { t } = useTranslation();
    const [loading, setLoading] = useState(false);
    const [chunks, setChunks] = useToolState<HexChunk[]>('hex-dump-chunks' as any, []);
	const inputRef = useRef<HTMLInputElement>(null);


	const handleFile = useCallback(async (file: File) => {
        setLoading(true);
        setChunks([]);
        
        // Limit file size to avoid crashing (e.g. 5MB)
        if (file.size > 5 * 1024 * 1024) {
            alert('File too large (max 5MB)');
            setLoading(false);
            return;
        }

        const buffer = await file.arrayBuffer();
        const dump = createHexDump(buffer);
        setChunks(dump);
        setLoading(false);
	}, []);

	return (
		<div style={styles.wrapper}>
			<div style={styles.dropzone} onClick={() => inputRef.current?.click()}>
				<div>📁 {chunks.length > 0 ? 'Open another file' : 'Open file to dump'}</div>
				<input ref={inputRef} type="file" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
			</div>

            {loading && <div style={styles.loading}>⏳ Processing...</div>}

            {chunks.length > 0 && (
                <div style={styles.viewer}>
                    {chunks.map((chunk, i) => (
                        <div key={i} style={styles.line}>
                            <span style={styles.offset}>{chunk.offset}</span>
                            <span style={styles.hex}>{chunk.hex}</span>
                            <span style={styles.ascii}>{chunk.ascii}</span>
                        </div>
                    ))}
                </div>
            )}
		</div>
	);
};
