import React from 'react';
import type { TranslationFunction } from '../../../i18n';
import type { EditForm } from '../types';
import { styles } from '../styles';

import { ScriptMetaEditor } from './script-meta-editor';

interface ScriptEditorProps {
	form: EditForm;
	onChange: (form: EditForm) => void;
	onSave: () => void;
	onCancel: () => void;
	isEdit: boolean;
	t: TranslationFunction;
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

	// Count lines
	const lineCount = React.useMemo(() => form.code.split('\n').length, [form.code]);
	const lineNumbers = React.useMemo(
		() => Array.from({ length: lineCount }, (_, index) => index + 1),
		[lineCount],
	);

	return (
		<div style={styles.editorCard}>
			<div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--halo-text)' }}>
				{isEdit ? `✏️ ${t('userscripts.editScript', { defaultValue: 'Edit Script' })}` : `➕ ${t('userscripts.newScript', { defaultValue: 'New Script' })}`}
			</div>
			
			{/* Name, Type & RunAt row */}
			<ScriptMetaEditor form={form} onUpdate={update} t={t} />
			
			{/* Code editor with line numbers */}
			<div style={styles.editorContainer}>
				<div style={styles.lineNumbers} ref={lineNumbersRef}>
					{lineNumbers.map((lineNumber) => (
						<div key={lineNumber} style={{ height: '18px' }}>{lineNumber}</div>
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
				<button type="button" style={styles.btn} onClick={onSave}>
					{isEdit ? `💾 ${t('userscripts.saveChanges', { defaultValue: 'Save Changes' })}` : `➕ ${t('userscripts.addNew', { defaultValue: 'Add Script' })}`}
				</button>
				<button type="button" style={styles.btnSecondary} onClick={onCancel}>
					{t('common.cancel', { defaultValue: 'Cancel' })}
				</button>
			</div>
		</div>
	);
};
