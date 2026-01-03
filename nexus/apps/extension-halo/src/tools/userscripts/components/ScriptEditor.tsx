import React from 'react';
import type { UserScript, ScriptType, UserScriptRunAt, EditForm } from '../types';
import { styles } from '../styles';

// Inline segmented control styles
const segmentedStyles: Record<string, React.CSSProperties> = {
	wrapper: {
		display: 'inline-flex',
		borderRadius: '6px',
		overflow: 'hidden',
		border: '1px solid var(--halo-border)',
		background: 'var(--halo-bg-tertiary)',
	},
	button: {
		border: 'none',
		background: 'transparent',
		color: 'var(--halo-text-muted)',
		padding: '4px 10px',
		fontSize: '11px',
		fontWeight: 500,
		cursor: 'pointer',
		transition: 'all 0.15s',
		whiteSpace: 'nowrap',
	},
	buttonActive: {
		background: 'var(--halo-accent)',
		color: '#fff',
	},
};

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
			<div style={styles.editorRow}>
				<input
					style={styles.input}
					value={form.name}
					onChange={(e) => update('name', e.target.value)}
					placeholder={t('userscripts.name', { defaultValue: 'Script name' })}
				/>
				{/* Type: button group */}
				<div style={segmentedStyles.wrapper}>
					{[
						{ value: 'javascript' as ScriptType, label: 'JS' },
						{ value: 'css' as ScriptType, label: 'CSS' },
					].map((opt) => (
						<button
							key={opt.value}
							type="button"
							style={{
								...segmentedStyles.button,
								...(form.type === opt.value ? segmentedStyles.buttonActive : {}),
							}}
							onClick={() => update('type', opt.value)}
						>
							{opt.label}
						</button>
					))}
				</div>
				{/* RunAt: button group */}
				<div style={segmentedStyles.wrapper}>
					{[
						{ value: 'document_start' as UserScriptRunAt, label: 'Start' },
						{ value: 'document_end' as UserScriptRunAt, label: 'End' },
						{ value: 'document_idle' as UserScriptRunAt, label: 'Idle' },
					].map((opt) => (
						<button
							key={opt.value}
							type="button"
							style={{
								...segmentedStyles.button,
								...(form.runAt === opt.value ? segmentedStyles.buttonActive : {}),
							}}
							onClick={() => update('runAt', opt.value)}
						>
							{opt.label}
						</button>
					))}
				</div>
			</div>
			
			{/* Description */}
			<input
				style={styles.input}
				value={form.description}
				onChange={(e) => update('description', e.target.value)}
				placeholder={t('userscripts.description', { defaultValue: 'Description (optional)' })}
			/>
			
			{/* Matches (Multi-line) */}
			<div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
				<textarea
					style={styles.inputMulti}
					value={form.matches}
					onChange={(e) => update('matches', e.target.value)}
					placeholder={t('userscripts.matchesPlaceholder', { defaultValue: '*://*.example.com/*\n*://*.another.com/*' })}
				/>
			</div>
			
			{/* Exclude matches (Multi-line) */}
			<div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
				<textarea
					style={styles.inputMulti}
					value={form.excludeMatches}
					onChange={(e) => update('excludeMatches', e.target.value)}
					placeholder={t('userscripts.excludePlaceholder', { defaultValue: 'Exclude patterns (one per line)\nExample: *://*.example.com/ads/*' })}
				/>
			</div>
			
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
