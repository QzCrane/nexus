// goal: Code Snippets panel UI - create, edit, and manage code snippets

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import type { Snippet, Language, SnippetFilter } from './types';
import { getSnippets, createSnippet, updateSnippet, deleteSnippet, filterSnippets, copyToClipboard, LANGUAGES } from './core';
import { styles } from './panel.styles';

export const CodeSnippetsPanel: React.FC = () => {
	const { t } = useTranslation();
	const [snippets, setSnippets] = useState<Snippet[]>([]);
	const [filter, setFilter] = useState<SnippetFilter>({ search: '', language: 'all', tag: '' });
	const [editing, setEditing] = useState<Snippet | null>(null);
	const [isNew, setIsNew] = useState(false);

	// Load snippets
	const loadSnippets = useCallback(async () => {
		setSnippets(await getSnippets());
	}, []);

	useEffect(() => { loadSnippets(); }, [loadSnippets]);

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
	const handleSave = async () => {
		if (!editing || !editing.title.trim() || !editing.code.trim()) return;
		if (isNew) {
			await createSnippet({ title: editing.title, code: editing.code, language: editing.language, tags: editing.tags });
		} else {
			await updateSnippet(editing.id, { title: editing.title, code: editing.code, language: editing.language, tags: editing.tags });
		}
		setEditing(null);
		loadSnippets();
	};

	// Delete snippet
	const handleDelete = async (id: string) => {
		if (!confirm(t('codeSnippets.deleteConfirm'))) return;
		await deleteSnippet(id);
		loadSnippets();
	};

	// Copy snippet code
	const handleCopy = async (code: string) => {
		await copyToClipboard(code);
	};

	// Filtered list
	const filtered = filterSnippets(snippets, filter);

	return (
		<div style={styles.wrapper}>
			{/* Header */}
			<div style={styles.header}>
				<input
					style={styles.searchInput}
					placeholder={t('codeSnippets.search')}
					value={filter.search}
					onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
				/>
				<button style={styles.btn} onClick={handleNew}>+ {t('codeSnippets.new')}</button>
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
			<button style={styles.btnSecondary} onClick={() => onCopy(snippet.code)}>📋 {t('codeSnippets.copy')}</button>
			<button style={styles.btnSecondary} onClick={() => onEdit(snippet)}>✏️ {t('codeSnippets.edit')}</button>
			<button style={styles.btnSecondary} onClick={() => onDelete(snippet.id)}>🗑️</button>
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
	<div style={styles.modal} onClick={onClose}>
		<div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
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
				<button style={styles.btnSecondary} onClick={onClose}>{t('common.cancel')}</button>
				<button style={styles.btn} onClick={onSave}>{isNew ? t('codeSnippets.create') : t('codeSnippets.save')}</button>
			</div>
		</div>
	</div>
);
