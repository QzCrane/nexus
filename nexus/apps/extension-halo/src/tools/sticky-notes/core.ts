// goal: Sticky Notes core logic - CRUD operations for notes

import type { Note } from './types';
import { NOTE_COLORS } from './types';

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
export function createNote(content = '', color = NOTE_COLORS[0]!.id): Note {
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
	if (index >= 0) {
		notes[index] = { ...notes[index]!, ...updates, updatedAt: Date.now() };
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
	return NOTE_COLORS.find((c) => c.id === colorId) || NOTE_COLORS[0]!;
}
