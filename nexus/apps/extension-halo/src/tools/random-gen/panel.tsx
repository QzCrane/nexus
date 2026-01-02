// goal: Random Gen panel UI

import React, { useState, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import { generateHex, generateBase64, generateUUID, generateULID } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


type Type = 'UUID' | 'Heterogenous' | 'Hex' | 'Base64' | 'ULID';

export const RandomGenPanel: React.FC = () => {
	const { t } = useTranslation();
    const [type, setType] = useToolState<Type>('random-gen-type' as any, 'UUID');
    const [length, setLength] = useToolState<number>('random-gen-len' as any, 32);
    const [count, setCount] = useToolState<number>('random-gen-count' as any, 1);
    const [output, setOutput] = useToolState<string>('random-gen', '');


    const handleGenerate = useCallback(() => {
        const results: string[] = [];
        for (let i = 0; i < count; i++) {
            switch (type) {
                case 'UUID': results.push(generateUUID()); break;
                case 'ULID': results.push(generateULID()); break;
                case 'Hex': results.push(generateHex(length)); break;
                case 'Base64': results.push(generateBase64(length)); break;
                default: break;
            }
        }
        setOutput(results.join('\n'));
    }, [type, length, count]);

	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(output);
	}, [output]);

	return (
		<div style={styles.wrapper}>
            <div style={styles.toolbar}>
                 <div>
                    <span style={styles.label}>Type</span>
                    <div style={{ display: 'inline-flex', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--halo-border)', background: 'var(--halo-bg-tertiary)', marginTop: '4px' }}>
                        {([
                            { value: 'UUID' as Type, label: 'UUID' },
                            { value: 'ULID' as Type, label: 'ULID' },
                            { value: 'Hex' as Type, label: 'Hex' },
                            { value: 'Base64' as Type, label: 'B64' },
                        ]).map((opt) => (
                            <button
                                key={opt.value}
                                type="button"
                                style={{
                                    border: 'none',
                                    background: type === opt.value ? 'var(--halo-accent)' : 'transparent',
                                    color: type === opt.value ? '#fff' : 'var(--halo-text-muted)',
                                    padding: '4px 8px', fontSize: '10px', fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s',
                                }}
                                onClick={() => setType(opt.value)}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                 </div>
                 
                 {(type === 'Hex' || type === 'Base64') && (
                     <div>
                        <span style={styles.label}>Length</span>
                        <input type="number" style={styles.input} value={length} onChange={(e) => setLength(Number(e.target.value))} />
                     </div>
                 )}

                 <div>
                    <span style={styles.label}>Count</span>
                    <input type="number" style={styles.input} value={count} min="1" max="1000" onChange={(e) => setCount(Number(e.target.value))} />
                 </div>

                 <button style={{...styles.btn, marginTop: 'auto'}} onClick={handleGenerate}>⚡ Generate</button>
            </div>

			<div>
				<div style={styles.label}>Result</div>
				<textarea style={styles.textarea} value={output} readOnly />
                <button style={{...styles.btn, marginTop: '8px', width: '100%'}} onClick={handleCopy}>📋 Copy</button>
			</div>
		</div>
	);
};
