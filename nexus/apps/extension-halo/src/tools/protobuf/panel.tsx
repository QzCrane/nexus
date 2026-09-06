// goal: Protobuf panel UI

import type React from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from '../../i18n';
import { decodeProto, parseInput, type ProtoField } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


const FieldNode: React.FC<{ field: ProtoField }> = ({ field }) => {
    const { t } = useTranslation();
    return (
        <div style={styles.node}>
            <span style={styles.field}>{t('protobuf.field', { defaultValue: 'Field' })} {field.fieldNumber}</span>
            <span style={styles.type}>({t('protobuf.wire', { defaultValue: 'Wire' })} {field.wireType}) {field.interpretation ?? ''}</span>
            {!field.subMessage && <span style={styles.value}>: {String(field.value)}</span>}
            {field.raw && <details><summary>Raw bytes — schema type is unknown</summary><code>{Array.from(field.raw, (byte) => byte.toString(16).padStart(2, '0')).join(' ')}</code></details>}
            {field.subMessage && (
                <div>
                    {field.subMessage.map((sub) => <FieldNode key={sub.offset} field={sub} />)}
                </div>
            )}
        </div>
    );
};

export const ProtobufPanel: React.FC = () => {
    const { t } = useTranslation();
    const [input, setInput] = useToolState<string>('protobuf-input', '');
    const [format, setFormat] = useState<'auto' | 'hex' | 'base64'>('auto');


    const result = useMemo(() => {
        if (!input.trim()) return { fields: null, error: '' };
        try {
            const buffer = parseInput(input, format);
            if (!buffer) throw new Error('Invalid input encoding or input exceeds the interactive size limit');
            return { fields: decodeProto(buffer), error: '' };
        } catch (error) {
            return { fields: null, error: error instanceof Error ? error.message : 'Wire decode failed' };
        }
    }, [input, format]);
    const decoded = result.fields;

    return (
        <div style={styles.wrapper}>
            <label>Encoding <select value={format} onChange={(event) => setFormat(event.target.value as typeof format)}>
                <option value="auto">Auto (hex takes precedence)</option><option value="hex">Hex</option><option value="base64">Base64</option>
            </select></label>
            {result.error && <div role="alert">{result.error}</div>}
            <textarea 
                style={styles.textarea} 
                value={input} 
                onChange={(e) => setInput(e.target.value)} 
                placeholder={t('protobuf.placeholder', { defaultValue: 'Paste Base64 or Hex protobuf data...' })}
            />

            <div style={styles.viewer}>
                {decoded ? (
                    decoded.length > 0 ? (
                        decoded.map((f) => <FieldNode key={f.offset} field={f} />)
                    ) : (
                        <div style={{color: 'var(--halo-text-muted)'}}>{t('protobuf.noFields', { defaultValue: 'No fields found or invalid format' })}</div>
                    )
                ) : (
                    <div style={{color: 'var(--halo-text-muted)'}}>{t('protobuf.waiting', { defaultValue: 'Waiting for input...' })}</div>
                )}
            </div>
        </div>
    );
};
