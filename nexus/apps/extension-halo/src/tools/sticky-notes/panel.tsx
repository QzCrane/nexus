// goal: Sticky Notes panel UI - create and manage notes

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import type { Note } from './types';
import { NOTE_COLORS } from './types';
import { getNotes, saveNotes, createNote, deleteNote, getColorConfig } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';


export const StickyNotesPanel: React.FC = () => {
	const { t } = useTranslation();
	const [notes, setNotes] = useToolState<Note[]>('sticky-notes' as any, []);


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
				<button style={styles.btn} onClick={handleAdd}>+ {t('stickyNotes.add')}</button>
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
								onMouseEnter={(e) => { const actions = e.currentTarget.querySelector('.note-actions') as HTMLElement; if (actions) actions.style.opacity = '1'; }}
								onMouseLeave={(e) => { const actions = e.currentTarget.querySelector('.note-actions') as HTMLElement; if (actions) actions.style.opacity = '0'; }}
							>
								<textarea
									style={{ ...styles.textarea, color: color.text }}
									value={note.content}
									onChange={(e) => handleUpdate(note.id, e.target.value)}
									placeholder={t('stickyNotes.placeholder')}
								/>
								<div className="note-actions" style={styles.noteActions}>
									<button style={styles.actionBtn} onClick={() => handleDelete(note.id)}>🗑️</button>
								</div>
								<div style={styles.colors}>
									{NOTE_COLORS.map((c) => (
										<div
											key={c.id}
											style={{ ...styles.colorDot, background: c.bg, borderColor: note.color === c.id ? c.text : 'transparent' }}
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
