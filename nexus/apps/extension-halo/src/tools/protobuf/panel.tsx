// goal: Protobuf panel UI

import React, { useState, useMemo } from 'react';
import { useTranslation } from '../../i18n';
import { decodeProto, parseInput, type ProtoField } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


const FieldNode: React.FC<{ field: ProtoField }> = ({ field }) => {
    const { t } = useTranslation();
    return (
        <div style={styles.node}>
            <span style={styles.field}>{t('protobuf.field', { defaultValue: 'Field' })} {field.fieldNumber}</span>
            <span style={styles.type}>({t('protobuf.wire', { defaultValue: 'Wire' })} {field.wireType})</span>
            {!field.subMessage && <span style={styles.value}>: {String(field.value)}</span>}
            {field.subMessage && (
                <div>
                    {field.subMessage.map((sub, i) => <FieldNode key={i} field={sub} />)}
                </div>
            )}
        </div>
    );
};

export const ProtobufPanel: React.FC = () => {
    const { t } = useTranslation();
    const [input, setInput] = useToolState<string>('protobuf-input' as any, '');


    const decoded = useMemo(() => {
        if (!input.trim()) return null;
        const buffer = parseInput(input.trim());
        if (!buffer) return null;
        return decodeProto(buffer);
    }, [input]);

    return (
        <div style={styles.wrapper}>
            <textarea 
                style={styles.textarea} 
                value={input} 
                onChange={(e) => setInput(e.target.value)} 
                placeholder={t('protobuf.placeholder', { defaultValue: 'Paste Base64 or Hex protobuf data...' })}
            />

            <div style={styles.viewer}>
                {decoded ? (
                    decoded.length > 0 ? (
                        decoded.map((f, i) => <FieldNode key={i} field={f} />)
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
