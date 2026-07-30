
import type React from 'react';
import type { TranslationFunction } from '../../../i18n';
import type { EditForm, ScriptType, UserScriptRunAt } from '../types';
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

interface ScriptMetaEditorProps {
	form: EditForm;
	onUpdate: <K extends keyof EditForm>(key: K, value: EditForm[K]) => void;
	t: TranslationFunction;
}

export const ScriptMetaEditor: React.FC<ScriptMetaEditorProps> = ({ form, onUpdate, t }) => {
	return (
		<>
			{/* Name, Type & RunAt row */}
			<div style={styles.editorRow}>
				<input
					style={{ ...styles.input, flex: 2 }}
					value={form.name}
					onChange={(e) => onUpdate('name', e.target.value)}
					placeholder={t('userscripts.name', { defaultValue: 'Script name' })}
				/>
				{/* Category Select */}
				<select
					style={{
						...styles.input,
						flex: 1,
						width: 'auto',
						cursor: 'pointer',
						appearance: 'none',
						paddingRight: '20px' // for arrow
					}}
					value={form.category || 'dev'}
					onChange={(e) => onUpdate('category', e.target.value)}
					title="Script Category"
				>
					{['general', 'dev', 'efficiency', 'visual', 'ai', 'security', 'media', 'browser'].map(c => (
						<option key={c} value={c}>{t(`categories.${c}`, { defaultValue: c.charAt(0).toUpperCase() + c.slice(1) })}</option>
					))}
				</select>

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
							onClick={() => onUpdate('type', opt.value)}
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
							onClick={() => onUpdate('runAt', opt.value)}
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
				onChange={(e) => onUpdate('description', e.target.value)}
				placeholder={t('userscripts.description', { defaultValue: 'Description (optional)' })}
			/>
			
			{/* Matches (Multi-line) */}
			<div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
				<textarea
					style={styles.inputMulti}
					value={form.matches}
					onChange={(e) => onUpdate('matches', e.target.value)}
					placeholder={t('userscripts.matchesPlaceholder', { defaultValue: '*://*.example.com/*\n*://*.another.com/*' })}
				/>
			</div>
			
			{/* Exclude matches (Multi-line) */}
			<div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
				<textarea
					style={styles.inputMulti}
					value={form.excludeMatches}
					onChange={(e) => onUpdate('excludeMatches', e.target.value)}
					placeholder={t('userscripts.excludePlaceholder', { defaultValue: 'Exclude patterns (one per line)\nExample: *://*.example.com/ads/*' })}
				/>
			</div>
		</>
	);
};
