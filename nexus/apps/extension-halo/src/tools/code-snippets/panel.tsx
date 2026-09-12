// goal: Code Snippets panel UI - create, edit, and manage code snippets

import type React from 'react';
import { useState } from 'react';
import { useTranslation } from '../../i18n';
import type { Snippet, Language, SnippetFilter } from './types';
import { CODE_SNIPPETS_STORAGE_KEY, CODE_SNIPPETS_QUOTA_POLICY, codeSnippetsCodec, snippetFilterCodec, snippetItemBytes, createSnippet, filterSnippets, copyToClipboard, LANGUAGES } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';
import { StorageRecoveryActions } from '../../components/sidepanel/StorageRecoveryActions';


export const CodeSnippetsPanel: React.FC = () => {
	const { t } = useTranslation();
	const [snippets, setSnippets, , recovery] = useToolState<Snippet[]>('code-snippets', [], {
		storageKey: CODE_SNIPPETS_STORAGE_KEY,
		codec: codeSnippetsCodec,
		quota: CODE_SNIPPETS_QUOTA_POLICY,
		quotaItemBytes: snippetItemBytes,
	});
	const [filter, setFilter] = useToolState<SnippetFilter>('code-snippets-filter', { search: '', language: 'all', tag: '' }, { codec: snippetFilterCodec });
	const [editing, setEditing] = useState<Snippet | null>(null);
	const [isNew, setIsNew] = useState(false);


	// Open editor for new snippet
	const handleNew = () => {
		setEditing({ id: '', title: '', code: '', language: 'javascript', tags: [], createdAt: 0, updatedAt: 0 });
		setIsNew(true);
	};

	// Open editor for existing snippet
	const handleEdit = (snippet: Snippet) => {
		setEditing({ ...snippet });
		setIsNew(false);
	};

	// Save snippet (create or update)
	const handleSave = () => {
		if (!editing?.title.trim() || !editing.code.trim()) return;
		if (isNew) {
			setSnippets((current) => [createSnippet({ title: editing.title, code: editing.code, language: editing.language, tags: editing.tags }), ...current]);
		} else {
			setSnippets((current) => current.map((snippet) => snippet.id === editing.id
				? { ...snippet, title: editing.title, code: editing.code, language: editing.language, tags: editing.tags, updatedAt: Date.now() }
				: snippet));
		}
		setEditing(null);
	};

	// Delete snippet
	const handleDelete = (id: string) => {
		if (!confirm(t('codeSnippets.deleteConfirm'))) return;
		setSnippets((current) => current.filter((snippet) => snippet.id !== id));
	};

	// Copy snippet code
	const handleCopy = async (code: string) => {
		await copyToClipboard(code);
	};

	// Filtered list
	const filtered = filterSnippets(snippets, filter);

	return (
		<div style={styles.wrapper}>
			<StorageRecoveryActions recovery={recovery} emptyValue={[]} exportName="halo-code-snippets-recovery.json" />
			{/* Header */}
			<div style={styles.header}>
				<input
					style={styles.searchInput}
					placeholder={t('codeSnippets.search')}
					value={filter.search}
					onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
				/>
				<button type="button" style={styles.btn} onClick={handleNew}>+ {t('codeSnippets.new')}</button>
			</div>

			{/* Filter */}
			<div style={styles.filterRow}>
				<select style={styles.select} value={filter.language} onChange={(e) => setFilter((f) => ({ ...f, language: e.target.value as Language | 'all' }))}>
					<option value="all">{t('codeSnippets.allLangs')}</option>
					{LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
				</select>
			</div>

			{/* Snippet List */}
			{filtered.length === 0 ? (
				<div style={styles.empty}>{t('codeSnippets.empty')}</div>
			) : (
				<div style={styles.list}>
					{filtered.map((s) => (
						<SnippetCard key={s.id} snippet={s} onEdit={handleEdit} onDelete={handleDelete} onCopy={handleCopy} t={t} />
					))}
				</div>
			)}

			{/* Editor Modal */}
			{editing && (
				<SnippetEditor editing={editing} setEditing={setEditing} onSave={handleSave} onClose={() => setEditing(null)} isNew={isNew} t={t} />
			)}
		</div>
	);
};

// Subcomponent: Snippet card
const SnippetCard: React.FC<{
	snippet: Snippet;
	onEdit: (s: Snippet) => void;
	onDelete: (id: string) => void;
	onCopy: (code: string) => void;
	t: (key: string) => string;
}> = ({ snippet, onEdit, onDelete, onCopy, t }) => (
	<div style={styles.card}>
		<div style={styles.cardHeader}>
			<span style={styles.title}>{snippet.title}</span>
			<div style={styles.meta}>
				<span style={styles.badge}>{snippet.language}</span>
				{snippet.tags.map((tag) => <span key={tag} style={styles.tag}>{tag}</span>)}
			</div>
		</div>
		<pre style={styles.codeBlock}>{snippet.code.slice(0, 300)}{snippet.code.length > 300 ? '...' : ''}</pre>
		<div style={styles.actions}>
			<button type="button" style={styles.btnSecondary} onClick={() => onCopy(snippet.code)}>📋 {t('codeSnippets.copy')}</button>
			<button type="button" style={styles.btnSecondary} onClick={() => onEdit(snippet)}>✏️ {t('codeSnippets.edit')}</button>
			<button type="button" style={styles.btnSecondary} onClick={() => onDelete(snippet.id)}>🗑️</button>
		</div>
	</div>
);

// Subcomponent: Editor modal
const SnippetEditor: React.FC<{
	editing: Snippet;
	setEditing: React.Dispatch<React.SetStateAction<Snippet | null>>;
	onSave: () => void;
	onClose: () => void;
	isNew: boolean;
	t: (key: string) => string;
}> = ({ editing, setEditing, onSave, onClose, isNew, t }) => (
	<div style={styles.modal}>
		<button
			type="button"
			aria-label={t('common.close')}
			onClick={onClose}
			style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', padding: 0, border: 'none', background: 'transparent' }}
		/>
		<div
			role="dialog"
			aria-modal="true"
			aria-label={isNew ? t('codeSnippets.create') : t('codeSnippets.edit')}
			style={{ ...styles.modalContent, position: 'relative', zIndex: 1 }}
		>
			<input
				style={styles.input}
				placeholder={t('codeSnippets.titlePlaceholder')}
				value={editing.title}
				onChange={(e) => setEditing((s) => s ? { ...s, title: e.target.value } : null)}
			/>
			<select style={styles.select} value={editing.language} onChange={(e) => setEditing((s) => s ? { ...s, language: e.target.value as Language } : null)}>
				{LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
			</select>
			<textarea
				style={styles.textarea}
				placeholder={t('codeSnippets.codePlaceholder')}
				value={editing.code}
				onChange={(e) => setEditing((s) => s ? { ...s, code: e.target.value } : null)}
			/>
			<input
				style={styles.input}
				placeholder={t('codeSnippets.tagsPlaceholder')}
				value={editing.tags.join(', ')}
				onChange={(e) => setEditing((s) => s ? { ...s, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) } : null)}
			/>
			<div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
				<button type="button" style={styles.btnSecondary} onClick={onClose}>{t('common.cancel')}</button>
				<button type="button" style={styles.btn} onClick={onSave}>{isNew ? t('codeSnippets.create') : t('codeSnippets.save')}</button>
			</div>
		</div>
	</div>
);
