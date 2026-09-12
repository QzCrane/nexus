// goal: Sticky Notes panel UI - create and manage notes

import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '../../i18n';
import type { Note } from './types';
import { NOTE_COLORS } from './types';
import { createNote, getColorConfig, stickyNotesCodec, STICKY_NOTES_STORAGE_KEY, LEGACY_STICKY_NOTES_STORAGE_KEY, STICKY_NOTES_QUOTA_POLICY, stickyNoteItemBytes } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';
import { StorageRecoveryActions } from '../../components/sidepanel/StorageRecoveryActions';


export const StickyNotesPanel: React.FC = () => {
	const { t } = useTranslation();
	const [notes, setNotes, , recovery] = useToolState<Note[]>('sticky-notes', [], {
		storageKey: STICKY_NOTES_STORAGE_KEY,
		codec: stickyNotesCodec,
		quota: STICKY_NOTES_QUOTA_POLICY,
		quotaItemBytes: stickyNoteItemBytes,
	});
	const [legacyNotes, setLegacyNotes] = useState<{ raw: unknown; value: Note[] | null } | null>(null);
	useEffect(() => {
		let active = true;
		void chrome.storage.local.get(LEGACY_STICKY_NOTES_STORAGE_KEY).then((stored) => {
			if (!active || stored[LEGACY_STICKY_NOTES_STORAGE_KEY] === undefined) return;
			const raw = stored[LEGACY_STICKY_NOTES_STORAGE_KEY];
			const decoded = stickyNotesCodec.decode(raw);
			setLegacyNotes({ raw, value: decoded.kind === 'valid' ? decoded.value : null });
		});
		return () => { active = false; };
	}, []);
	const exportLegacy = useCallback(() => {
		if (!legacyNotes) return;
		const url = URL.createObjectURL(new Blob([JSON.stringify(legacyNotes.raw, null, 2)], { type: 'application/json' }));
		const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'halo-sticky-notes-legacy.json'; anchor.click(); URL.revokeObjectURL(url);
	}, [legacyNotes]);


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
			<StorageRecoveryActions recovery={recovery} emptyValue={[]} exportName="halo-sticky-notes-recovery.json" />
			{legacyNotes && <div role="status" style={{ padding: 8, border: '1px solid var(--halo-border)', borderRadius: 6 }}>
				An older sticky-note copy was found and left unchanged.
				<button type="button" onClick={exportLegacy}>Export older copy</button>
				{legacyNotes.value && <button type="button" onClick={() => recovery.invalid ? recovery.replaceInvalid(legacyNotes.value ?? []) : setNotes(legacyNotes.value ?? [])}>Import copy and retain original</button>}
			</div>}
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
