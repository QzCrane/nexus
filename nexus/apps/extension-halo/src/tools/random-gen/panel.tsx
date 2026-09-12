// goal: Random Gen panel UI

import type React from 'react';
import { useCallback } from 'react';
import { useTranslation } from '../../i18n';
import { generateHex, generateBase64, generateUUID, generateULID, MAX_RANDOM_BYTE_LENGTH } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';
import type { ToolStateCodec } from '../../kernel/core/storage-codec';
import { StorageRecoveryActions } from '../../components/sidepanel/StorageRecoveryActions';


type Type = 'UUID' | 'Hex' | 'Base64' | 'ULID';
const randomTypeCodec: ToolStateCodec<Type> = {
	decode(value) { return value === 'UUID' || value === 'Hex' || value === 'Base64' || value === 'ULID' ? { kind: 'valid', value } : { kind: 'invalid', reason: 'Random generator type is unsupported.' }; },
	encode(value) { return value; },
};
const randomLengthCodec: ToolStateCodec<number> = {
	decode(value) { return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_RANDOM_BYTE_LENGTH ? { kind: 'valid', value: value as number } : { kind: 'invalid', reason: 'Random output length is outside the generator byte boundary.' }; },
	encode(value) { return value; },
};
const randomCountCodec: ToolStateCodec<number> = {
	decode(value) { return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 1000 ? { kind: 'valid', value: value as number } : { kind: 'invalid', reason: 'Random output count must be an integer from 1 to 1000.' }; },
	encode(value) { return value; },
};

export const RandomGenPanel: React.FC = () => {
	const { t } = useTranslation();
    const [type, setType, , typeRecovery] = useToolState<Type>('random-gen-type', 'UUID', { codec: randomTypeCodec });
    const [length, setLength, , lengthRecovery] = useToolState<number>('random-gen-len', 32, { codec: randomLengthCodec });
    const [count, setCount, , countRecovery] = useToolState<number>('random-gen-count', 1, { codec: randomCountCodec });
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
    }, [type, length, count, setOutput]);

	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(output);
	}, [output]);

	return (
		<div style={styles.wrapper}>
			<StorageRecoveryActions recovery={typeRecovery} emptyValue="UUID" exportName="halo-random-type-damaged.json" />
			<StorageRecoveryActions recovery={lengthRecovery} emptyValue={32} exportName="halo-random-length-damaged.json" />
			<StorageRecoveryActions recovery={countRecovery} emptyValue={1} exportName="halo-random-count-damaged.json" />
            <div style={styles.toolbar}>
                 <div>
                    <span style={styles.label}>{t('randomGen.type', { defaultValue: 'Type' })}</span>
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
                                    padding: '4px 8px', fontSize: '10px', fontWeight: 500, cursor: 'pointer', transition: 'var(--halo-motion-transition, all 0.15s)',
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
                        <span style={styles.label}>{t('randomGen.length', { defaultValue: 'Length' })}</span>
                        <input type="number" style={styles.input} value={length} onChange={(e) => setLength(Number(e.target.value))} />
                     </div>
                 )}

                 <div>
                    <span style={styles.label}>{t('randomGen.count', { defaultValue: 'Count' })}</span>
                    <input type="number" style={styles.input} value={count} min="1" max="1000" onChange={(e) => setCount(Number(e.target.value))} />
                 </div>

                 <button type="button" style={{...styles.btn, marginTop: 'auto'}} onClick={handleGenerate}>⚡ {t('randomGen.generate', { defaultValue: 'Generate' })}</button>
            </div>

			<div>
				<div style={styles.label}>{t('randomGen.result', { defaultValue: 'Result' })}</div>
				<textarea style={styles.textarea} value={output} readOnly />
                <button type="button" style={{...styles.btn, marginTop: '8px', width: '100%'}} onClick={handleCopy}>📋 {t('randomGen.copy', { defaultValue: 'Copy' })}</button>
			</div>
		</div>
	);
};
