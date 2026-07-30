// goal: Hex Dump panel UI

import type React from 'react';
import { useState, useCallback } from 'react';
import { createHexDump, type HexChunk } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';




export const HexDumpPanel: React.FC = () => {
    const [loading, setLoading] = useState(false);
    const [chunks, setChunks] = useToolState<HexChunk[]>('hex-dump-chunks', []);


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
	}, [setChunks]);

	return (
		<div style={styles.wrapper}>
			<label style={styles.dropzone}>
				<div>📁 {chunks.length > 0 ? 'Open another file' : 'Open file to dump'}</div>
				<input type="file" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
			</label>

            {loading && <div style={styles.loading}>⏳ Processing...</div>}

            {chunks.length > 0 && (
                <div style={styles.viewer}>
                    {chunks.map((chunk) => (
                        <div key={chunk.offset} style={styles.line}>
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
