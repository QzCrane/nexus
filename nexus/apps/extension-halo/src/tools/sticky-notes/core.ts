// goal: Sticky Notes core logic - CRUD operations for notes

import type { Note } from './types';
import { DEFAULT_NOTE_COLOR, NOTE_COLORS } from './types';

const STORAGE_KEY = 'halo-sticky-notes';

// Generate unique ID
export function generateId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Get all notes
export async function getNotes(): Promise<Note[]> {
	return new Promise((resolve) => {
		chrome.storage.local.get(STORAGE_KEY, (result) => {
			resolve(result[STORAGE_KEY] || []);
		});
	});
}

// Save all notes
export async function saveNotes(notes: Note[]): Promise<void> {
	return chrome.storage.local.set({ [STORAGE_KEY]: notes });
}

// Create new note
export function createNote(content = '', color = DEFAULT_NOTE_COLOR.id): Note {
	const now = Date.now();
	return {
		id: generateId(),
		content,
		color,
		createdAt: now,
		updatedAt: now,
	};
}

// Update note
export async function updateNote(id: string, updates: Partial<Note>): Promise<Note[]> {
	const notes = await getNotes();
	const index = notes.findIndex((n) => n.id === id);
	const note = index >= 0 ? notes[index] : undefined;
	if (note) {
		notes[index] = { ...note, ...updates, updatedAt: Date.now() };
		await saveNotes(notes);
	}
	return notes;
}

// Delete note
export async function deleteNote(id: string): Promise<Note[]> {
	const notes = await getNotes();
	const filtered = notes.filter((n) => n.id !== id);
	await saveNotes(filtered);
	return filtered;
}

// Get color config
export function getColorConfig(colorId: string) {
	return NOTE_COLORS.find((c) => c.id === colorId) ?? DEFAULT_NOTE_COLOR;
}
