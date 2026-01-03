// goal: Full-page script editor for userscripts
// eff: Replaces inline expand with dedicated page for better UX

import React from 'react';
import type { EditForm } from '../types';
import { ScriptMetaEditor } from './script-meta-editor';
import { pageStyles } from '../styles/editor-page';

type TFunc = (key: string, opts?: { defaultValue?: string } & Record<string, any>) => string;

interface ScriptEditorPageProps {
	form: EditForm;
	onChange: (form: EditForm) => void;
	onSave: () => void;
	onCancel: () => void;
	isEdit: boolean;
	t: TFunc;
}

export const ScriptEditorPage: React.FC<ScriptEditorPageProps> = ({
	form, onChange, onSave, onCancel, isEdit, t,
}) => {
	const textareaRef = React.useRef<HTMLTextAreaElement>(null);
	const lineNumbersRef = React.useRef<HTMLDivElement>(null);

	const update = <K extends keyof EditForm>(key: K, value: EditForm[K]) => {
		onChange({ ...form, [key]: value });
	};

	const handleScroll = () => {
		if (textareaRef.current && lineNumbersRef.current) {
			lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
		}
	};

	const lineCount = React.useMemo(() => form.code.split('\n').length, [form.code]);
	const getTypeIcon = () => form.type === 'css' ? '🎨' : '⚡';
	const getTypeGradient = () => form.type === 'css' 
		? 'linear-gradient(135deg, #2196F3, #1976D2)' 
		: 'linear-gradient(135deg, #FFD700, #FFA500)';

	return (
		<div style={pageStyles.container}>
			{/* Header */}
			<div style={pageStyles.header}>
				<button style={pageStyles.backBtn} onClick={onCancel} title={t('common.back', { defaultValue: 'Back' })}>←</button>
				<div style={pageStyles.title}>
					<span style={{ ...pageStyles.titleIcon, background: getTypeGradient() }}>{getTypeIcon()}</span>
					{isEdit ? t('userscripts.editScript', { defaultValue: 'Edit Script' }) : t('userscripts.newScript', { defaultValue: 'New Script' })}
					{form.name && <span style={{ color: 'var(--halo-text-muted)', fontWeight: 400 }}>- {form.name}</span>}
				</div>
			</div>

			{/* Content */}
			<div style={pageStyles.content}>
				<div style={pageStyles.section}>
					<div style={pageStyles.sectionTitle}><span>📝</span>{t('userscripts.scriptInfo', { defaultValue: 'Script Info' })}</div>
					<ScriptMetaEditor form={form} onUpdate={update} t={t} />
				</div>

				<div style={{ ...pageStyles.section, flex: 1 }}>
					<div style={pageStyles.sectionTitle}><span>💻</span>{t('userscripts.code', { defaultValue: 'Code' })}</div>
					<div style={pageStyles.editorWrapper}>
						<div style={pageStyles.editorHeader}>
							<span style={{ ...pageStyles.langBadge, ...(form.type === 'css' ? pageStyles.langBadgeCSS : pageStyles.langBadgeJS) }}>
								{form.type === 'css' ? 'CSS' : 'JavaScript'}
							</span>
							<span style={{ fontSize: '11px', color: 'var(--halo-text-muted)' }}>
								{lineCount} {t('userscripts.lines', { defaultValue: 'lines' })}
							</span>
						</div>
						<div style={pageStyles.codeContainer}>
							<div style={pageStyles.lineNumbers} ref={lineNumbersRef}>
								{Array.from({ length: lineCount }, (_, i) => <div key={i}>{i + 1}</div>)}
							</div>
							<textarea
								ref={textareaRef}
								style={pageStyles.codeArea}
								value={form.code}
								onChange={(e) => update('code', e.target.value)}
								onScroll={handleScroll}
								placeholder={form.type === 'css' ? t('userscripts.codePlaceholderCSS', { defaultValue: '/* Your CSS here... */' }) : t('userscripts.codePlaceholderJS', { defaultValue: '// Your JavaScript here...' })}
								spellCheck={false}
							/>
						</div>
					</div>
				</div>
			</div>

			{/* Footer */}
			<div style={pageStyles.footer}>
				<button style={{ ...pageStyles.btn, ...pageStyles.btnSecondary }} onClick={onCancel}>{t('common.cancel', { defaultValue: 'Cancel' })}</button>
				<button style={{ ...pageStyles.btn, ...pageStyles.btnPrimary }} onClick={onSave}>
					{isEdit ? '💾' : '➕'} {isEdit ? t('userscripts.saveChanges', { defaultValue: 'Save Changes' }) : t('userscripts.addNew', { defaultValue: 'Add Script' })}
				</button>
			</div>
		</div>
	);
};
