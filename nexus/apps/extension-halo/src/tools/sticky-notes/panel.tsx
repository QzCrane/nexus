// goal: Sticky Notes panel UI - create and manage notes

import type React from 'react';
import { useCallback } from 'react';
import { useTranslation } from '../../i18n';
import type { Note } from './types';
import { NOTE_COLORS } from './types';
import { createNote, getColorConfig } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const StickyNotesPanel: React.FC = () => {
	const { t } = useTranslation();
	const [notes, setNotes] = useToolState<Note[]>('sticky-notes', []);


	// Add new note
	const handleAdd = useCallback(async () => {
		const newNote = createNote();
		setNotes([newNote, ...notes]);
	}, [notes, setNotes]);


	// Update note content
	const handleUpdate = useCallback(async (id: string, content: string) => {
		setNotes(notes.map((n) => n.id === id ? { ...n, content, updatedAt: Date.now() } : n));
	}, [notes, setNotes]);


	// Update note color
	const handleColor = useCallback(async (id: string, color: string) => {
		setNotes(notes.map((n) => n.id === id ? { ...n, color, updatedAt: Date.now() } : n));
	}, [notes, setNotes]);


	// Delete note
	const handleDelete = useCallback(async (id: string) => {
		setNotes(notes.filter((n) => n.id !== id));
	}, [notes, setNotes]);


	return (
		<div style={styles.wrapper}>
			{/* Header */}
			<div style={styles.header}>
				<span style={styles.title}>📝 {t('stickyNotes.title')}</span>
				<button type="button" style={styles.btn} onClick={handleAdd}>+ {t('stickyNotes.add')}</button>
			</div>

			{/* Notes Grid */}
			{notes.length === 0 ? (
				<div style={styles.empty}>💡 {t('stickyNotes.empty')}</div>
			) : (
				<div style={styles.grid}>
					{notes.map((note) => {
						const color = getColorConfig(note.color);
						return (
							<div
								key={note.id}
								style={{ ...styles.note, background: color.bg, color: color.text }}
							>
								<textarea
									style={{ ...styles.textarea, color: color.text }}
									value={note.content}
									onChange={(e) => handleUpdate(note.id, e.target.value)}
									placeholder={t('stickyNotes.placeholder')}
								/>
								<div className="note-actions" style={{ ...styles.noteActions, opacity: 1 }}>
									<button type="button" style={styles.actionBtn} onClick={() => handleDelete(note.id)}>🗑️</button>
								</div>
								<div style={styles.colors}>
									{NOTE_COLORS.map((c) => (
										<button
											type="button"
											key={c.id}
											aria-label={c.id}
											aria-pressed={note.color === c.id}
											style={{ ...styles.colorDot, background: c.bg, borderColor: note.color === c.id ? c.text : 'transparent', padding: 0 }}
											onClick={() => handleColor(note.id, c.id)}
										/>
									))}
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
};
