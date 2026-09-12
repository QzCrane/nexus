// goal: Hex Dump panel UI

import type React from 'react';
import { useCallback } from 'react';
import { createHexDump, hexChunksCodec, type HexChunk } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';
import { useOwnedAsyncTask } from '../../kernel/hooks/use-owned-async-task';
import { StorageRecoveryActions } from '../../components/sidepanel/StorageRecoveryActions';




export const HexDumpPanel: React.FC = () => {
	const [chunks, setChunks, , chunksRecovery] = useToolState<HexChunk[]>('hex-dump-chunks', [], { codec: hexChunksCodec });
	const task = useOwnedAsyncTask();


	const handleFile = useCallback(async (file: File) => {
        setChunks([]);
        
        // Limit file size to avoid crashing (e.g. 5MB)
        if (file.size > 5 * 1024 * 1024) {
            alert('File too large (max 5MB)');
            return;
        }

		const outcome = await task.run(async () => createHexDump(await file.arrayBuffer()));
		if (outcome.kind === 'succeeded') setChunks(outcome.value);
	}, [setChunks, task.run]);

	return (
		<div style={styles.wrapper}>
			<StorageRecoveryActions recovery={chunksRecovery} emptyValue={[]} exportName="halo-hex-dump-damaged.json" />
			<label style={styles.dropzone}>
				<div>📁 {chunks.length > 0 ? 'Open another file' : 'Open file to dump'}</div>
				<input type="file" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
			</label>

			{task.phase === 'running' && <div style={styles.loading}>⏳ Processing...</div>}
			{task.error !== null && <div role="alert" style={{ color: 'var(--halo-danger, #d33)' }}>{String(task.error)}</div>}

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
