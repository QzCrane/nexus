import React from 'react';
import type { UserScript, ScriptType, UserScriptRunAt, EditForm } from '../types';
import { styles } from '../styles';

import { ScriptMetaEditor } from './script-meta-editor';

type TFunc = (key: string, opts?: { defaultValue?: string } & Record<string, any>) => string;

interface ScriptEditorProps {
	form: EditForm;
	onChange: (form: EditForm) => void;
	onSave: () => void;
	onCancel: () => void;
	isEdit: boolean;
	t: TFunc;
}

export const ScriptEditor: React.FC<ScriptEditorProps> = ({
	form,
	onChange,
	onSave,
	onCancel,
	isEdit,
	t,
}) => {
	const textareaRef = React.useRef<HTMLTextAreaElement>(null);
	const lineNumbersRef = React.useRef<HTMLDivElement>(null);

	const update = <K extends keyof EditForm>(key: K, value: EditForm[K]) => {
		onChange({ ...form, [key]: value });
	};

	// Sync scrolling
	const handleScroll = () => {
		if (textareaRef.current && lineNumbersRef.current) {
			lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
		}
	};

	// Prevent parent scroll
	const handleWheel = (e: React.WheelEvent) => {
		e.stopPropagation();
	};

	// Count lines
	const lineCount = React.useMemo(() => form.code.split('\n').length, [form.code]);

	return (
		<div style={styles.editorCard}>
			<div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--halo-text)' }}>
				{isEdit ? `✏️ ${t('userscripts.editScript', { defaultValue: 'Edit Script' })}` : `➕ ${t('userscripts.newScript', { defaultValue: 'New Script' })}`}
			</div>
			
			{/* Name, Type & RunAt row */}
			<ScriptMetaEditor form={form} onUpdate={update} t={t} />
			
			{/* Code editor with line numbers */}
			<div style={styles.editorContainer} onWheel={handleWheel}>
				<div style={styles.lineNumbers} ref={lineNumbersRef}>
					{Array.from({ length: lineCount }, (_, i) => (
						<div key={i} style={{ height: '18px' }}>{i + 1}</div>
					))}
				</div>
				<textarea
					ref={textareaRef}
					style={{ ...styles.codeArea, height: '100%', lineHeight: '18px' }} // Force line-height for sync
					value={form.code}
					onChange={(e) => update('code', e.target.value)}
					onScroll={handleScroll}
					placeholder={form.type === 'css' ? t('userscripts.codePlaceholderCSS', { defaultValue: '/* Your CSS here... */' }) : t('userscripts.codePlaceholderJS', { defaultValue: '// Your JavaScript here...' })}
					spellCheck={false}
				/>
			</div>
			
			{/* Action buttons */}
			<div style={styles.btnGroup}>
				<button style={styles.btn} onClick={onSave}>
					{isEdit ? `💾 ${t('userscripts.saveChanges', { defaultValue: 'Save Changes' })}` : `➕ ${t('userscripts.addNew', { defaultValue: 'Add Script' })}`}
				</button>
				<button style={styles.btnSecondary} onClick={onCancel}>
					{t('common.cancel', { defaultValue: 'Cancel' })}
				</button>
			</div>
		</div>
	);
};
