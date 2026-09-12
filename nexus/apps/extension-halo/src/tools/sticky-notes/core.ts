// goal: Sticky Notes identity, persistence codec, and value construction

import type { ToolStateCodec } from '../../kernel/core/storage-codec';
import type { StorageQuotaPolicy } from '../../kernel/core/storage-quota';
import type { Note } from './types';
import { DEFAULT_NOTE_COLOR, NOTE_COLORS } from './types';

export const STICKY_NOTES_STORAGE_KEY = 'halo_tool_state_sticky-notes';
export const LEGACY_STICKY_NOTES_STORAGE_KEY = 'halo-sticky-notes';
// The three authored-data domains consume at most 70% of Chrome's reported
// local quota together; the shared admission owner retains another 20%.
export const STICKY_NOTES_QUOTA_POLICY: StorageQuotaPolicy = { maxAreaFraction: 0.2, maxItemAreaFraction: 0.02 };
const NOTE_COLOR_IDS = new Set<string>(NOTE_COLORS.map((color) => color.id));

function parseNotes(value: unknown): Note[] | null {
	if (!Array.isArray(value)) return null;
	const ids = new Set<string>();
	const notes: Note[] = [];
	for (const row of value) {
		if (typeof row !== 'object' || row === null || Array.isArray(row)) return null;
		const note = row as Record<string, unknown>;
		if (typeof note.id !== 'string' || note.id.trim() === '' || ids.has(note.id)) return null;
		if (typeof note.content !== 'string' || typeof note.color !== 'string' || !NOTE_COLOR_IDS.has(note.color)) return null;
		if (!Number.isSafeInteger(note.createdAt) || (note.createdAt as number) < 0) return null;
		if (!Number.isSafeInteger(note.updatedAt) || (note.updatedAt as number) < (note.createdAt as number)) return null;
		ids.add(note.id);
		notes.push({ id: note.id, content: note.content, color: note.color, createdAt: note.createdAt as number, updatedAt: note.updatedAt as number });
	}
	return notes;
}

export const stickyNotesCodec: ToolStateCodec<Note[]> = {
	decode(value) {
		const candidate = Array.isArray(value)
			? value
			: typeof value === 'object' && value !== null && !Array.isArray(value)
				&& (value as Record<string, unknown>).version === 1
				? (value as Record<string, unknown>).items
				: null;
		const notes = parseNotes(candidate);
		return notes ? { kind: 'valid', value: notes } : { kind: 'invalid', reason: 'Sticky-note data has invalid fields, identities, timestamps, or version.' };
	},
	encode(value) { return { version: 1, items: value }; },
};

export function generateId(): string { return crypto.randomUUID(); }

export function createNote(content = '', color = DEFAULT_NOTE_COLOR.id): Note {
	const now = Date.now();
	return { id: generateId(), content, color, createdAt: now, updatedAt: now };
}

export function getColorConfig(colorId: string) {
	return NOTE_COLORS.find((color) => color.id === colorId) ?? DEFAULT_NOTE_COLOR;
}

export function stickyNoteItemBytes(items: readonly Note[]): number[] {
	const encoder = new TextEncoder();
	return items.map((item) => encoder.encode(JSON.stringify(item)).byteLength);
}
