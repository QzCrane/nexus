// goal: UserScripts panel components - reusable UI parts
// eff: Separated for maintainability and line count

import React from 'react';
import type { UserScript, ScriptType, UserScriptRunAt } from './types';
import { styles } from './panel.styles';

// Translation function type
type TFunc = (key: string, opts?: { defaultValue?: string } & Record<string, any>) => string;

// Props types
interface ScriptItemProps {
	script: UserScript;
	isFirst: boolean;
	isLast: boolean;
	onToggle: () => void;
	onEdit: () => void;
	onDelete: () => void;
	onTest: () => void;
	onMove: (dir: 'up' | 'down') => void;
	isActive?: boolean;
	t: TFunc;
}

interface ScriptEditorProps {
	form: EditForm;
	onChange: (form: EditForm) => void;
	onSave: () => void;
	onCancel: () => void;
	isEdit: boolean;
	t: TFunc;
}

interface EditForm {
	name: string;
	description: string;
	code: string;
	matches: string;
	excludeMatches: string;
	type: ScriptType;
	runAt: UserScriptRunAt;
}

// Script list item component
export const ScriptItem: React.FC<ScriptItemProps> = ({
	script,
	isFirst,
	isLast,
	onToggle,
	onEdit,
	onDelete,
	onTest,
	onMove,
	isActive,
	t,
}) => {
	const formatDate = (ts?: number) => {
		if (!ts) return t('userscripts.never', { defaultValue: 'Never' });
		return new Date(ts).toLocaleDateString();
	};

	return (
		<div
			style={{
				...styles.scriptCard,
				...(script.enabled ? {} : styles.scriptCardDisabled),
			}}
		>
			<div style={styles.scriptHeader}>
				<div style={styles.scriptInfo}>
					<div style={styles.scriptTitle}>{script.name}</div>
					<div style={styles.scriptMeta}>
						<span style={{
							...styles.scriptBadge,
							...(script.type === 'css' ? styles.scriptBadgeCSS : {}),
						}}>
							{script.type.toUpperCase()}
						</span>
						{/* Active Status */}
						<span style={{ 
							display: 'flex', 
							alignItems: 'center', 
							gap: '4px',
							color: isActive ? '#4CAF50' : 'var(--halo-text-secondary)',
							fontWeight: isActive ? 600 : 400 
						}}>
							<span style={{ 
								width: '6px', 
								height: '6px', 
								borderRadius: '50%', 
								background: isActive ? '#4CAF50' : '#ccc',
								boxShadow: isActive ? '0 0 4px #4CAF50' : 'none'
							}} />
							{isActive ? t('userscripts.activeOnSite', { defaultValue: 'Active' }) : t('userscripts.inactiveOnSite', { defaultValue: 'Inactive' })}
						</span>
						<span>📍 {script.matches.length} {t('userscripts.matches', { defaultValue: 'match' })}{script.matches.length !== 1 ? 'es' : ''}</span>
						<span>▶️ {script.runCount}x</span>
						{script.lastRun && <span>📅 {formatDate(script.lastRun)}</span>}
					</div>
				</div>
				<div style={styles.scriptActions}>
					{/* Reorder buttons */}
					<button
						style={{ ...styles.iconBtn, opacity: isFirst ? 0.3 : 1 }}
						onClick={(e) => { e.stopPropagation(); onMove('up'); }}
						disabled={isFirst}
						title="Move up"
					>↑</button>
					<button
						style={{ ...styles.iconBtn, opacity: isLast ? 0.3 : 1 }}
						onClick={(e) => { e.stopPropagation(); onMove('down'); }}
						disabled={isLast}
						title="Move down"
					>↓</button>
					
					{/* Toggle */}
					<div
						style={{ ...styles.toggle, ...(script.enabled ? styles.toggleActive : {}) }}
						onClick={(e) => { e.stopPropagation(); onToggle(); }}
					>
						<div style={{ ...styles.toggleKnob, left: script.enabled ? '18px' : '2px' }} />
					</div>
				</div>
			</div>
			
			{/* Action row */}
			<div style={{ ...styles.btnGroup, marginTop: '10px' }}>
				<button style={styles.btnSecondary} onClick={onEdit}>✏️ {t('userscripts.edit', { defaultValue: 'Edit' })}</button>
				<button style={styles.btnSecondary} onClick={onTest}>▶️ {t('userscripts.test', { defaultValue: 'Test' })}</button>
				<button
					style={{ ...styles.iconBtn, ...styles.iconBtnDanger }}
					onClick={onDelete}
					title="Delete"
				>🗑️</button>
			</div>
		</div>
	);
};

// Script editor component
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
				<select
					style={styles.select}
					value={form.type}
					onChange={(e) => update('type', e.target.value as ScriptType)}
				>
					<option value="javascript">JavaScript</option>
					<option value="css">CSS</option>
				</select>
				<select
					style={styles.select}
					value={form.runAt}
					onChange={(e) => update('runAt', e.target.value as UserScriptRunAt)}
				>
					<option value="document_start">document_start</option>
					<option value="document_end">document_end</option>
					<option value="document_idle">document_idle</option>
				</select>
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

// Import/Export Modal - inline card style for sidebar
interface ImportExportModalProps {
	mode: 'import' | 'export';
	exportData?: string;
	onImport: (json: string) => void;
	onClose: () => void;
	t: TFunc;
}

export const ImportExportModal: React.FC<ImportExportModalProps> = ({
	mode,
	exportData,
	onImport,
	onClose,
	t,
}) => {
	const [importText, setImportText] = React.useState('');
	const [copied, setCopied] = React.useState(false);

	const handleCopy = () => {
		if (exportData) {
			navigator.clipboard.writeText(exportData);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		}
	};

	const handleImport = () => {
		if (importText.trim()) onImport(importText);
	};

	// Inline card rendering (no overlay)
	return (
		<div style={styles.modal}>
			<div style={styles.modalContent}>
				<div style={styles.modalTitle}>
					{mode === 'export'
						? `📤 ${t('userscripts.exportTitle', { defaultValue: 'Export Scripts' })}`
						: `📥 ${t('userscripts.importTitle', { defaultValue: 'Import Scripts' })}`}
				</div>
				
				{mode === 'export' ? (
					<>
						<textarea
							style={{ ...styles.textarea, minHeight: '120px' }}
							value={exportData || ''}
							readOnly
						/>
						<button style={styles.btn} onClick={handleCopy}>
							{copied
								? `✅ ${t('common.copied', { defaultValue: 'Copied!' })}`
								: `📋 ${t('common.copy', { defaultValue: 'Copy to Clipboard' })}`}
						</button>
					</>
				) : (
					<>
						<textarea
							style={{ ...styles.textarea, minHeight: '120px' }}
							value={importText}
							onChange={(e) => setImportText(e.target.value)}
							placeholder={t('userscripts.importPlaceholder', { defaultValue: 'Paste exported JSON here...' })}
						/>
						<button style={styles.btn} onClick={handleImport}>
							📥 {t('userscripts.import', { defaultValue: 'Import' })}
						</button>
					</>
				)}
				
				<button style={styles.btnSecondary} onClick={onClose}>
					{t('common.close', { defaultValue: 'Close' })}
				</button>
			</div>
		</div>
	);
};

// Empty state component
interface EmptyStateProps {
	t: TFunc;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ t }) => (
	<div style={styles.emptyState}>
		<div style={styles.emptyIcon}>📜</div>
		<div>{t('userscripts.empty', { defaultValue: 'No scripts yet' })}</div>
		<div style={{ fontSize: '12px', marginTop: '4px', opacity: 0.7 }}>
			{t('userscripts.emptyDesc', { defaultValue: 'Add a script or choose a template to get started' })}
		</div>
	</div>
);

// Export edit form type
export type { EditForm };
