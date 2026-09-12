// goal: Todo List domain identity, persistence codec, and pure mutations

import type { ToolStateCodec } from '../../kernel/core/storage-codec';
import type { StorageQuotaPolicy } from '../../kernel/core/storage-quota';
import type { TodoItem } from './types';

export const TODO_STORAGE_KEY = 'halo_todo_list';
// Todo text is the smallest authored-data allocation; no item is evicted to
// admit another item when this quota-relative boundary is reached.
export const TODO_QUOTA_POLICY: StorageQuotaPolicy = { maxAreaFraction: 0.1, maxItemAreaFraction: 0.001 };
const PRIORITIES = new Set<TodoItem['priority']>(['low', 'medium', 'high']);

function parseTodos(value: unknown): TodoItem[] | null {
	if (!Array.isArray(value)) return null;
	const ids = new Set<string>();
	const items: TodoItem[] = [];
	for (const row of value) {
		if (typeof row !== 'object' || row === null || Array.isArray(row)) return null;
		const todo = row as Record<string, unknown>;
		if (typeof todo.id !== 'string' || todo.id.trim() === '' || ids.has(todo.id)) return null;
		if (typeof todo.text !== 'string' || typeof todo.completed !== 'boolean') return null;
		if (!Number.isSafeInteger(todo.createdAt) || (todo.createdAt as number) < 0) return null;
		if (typeof todo.priority !== 'string' || !PRIORITIES.has(todo.priority as TodoItem['priority'])) return null;
		ids.add(todo.id);
		items.push({ id: todo.id, text: todo.text, completed: todo.completed, createdAt: todo.createdAt as number, priority: todo.priority as TodoItem['priority'] });
	}
	return items;
}

export const todoListCodec: ToolStateCodec<TodoItem[]> = {
	decode(value) {
		const candidate = Array.isArray(value)
			? value
			: typeof value === 'object' && value !== null && !Array.isArray(value)
				&& (value as Record<string, unknown>).version === 1
				? (value as Record<string, unknown>).items
				: null;
		const items = parseTodos(candidate);
		return items ? { kind: 'valid', value: items } : { kind: 'invalid', reason: 'Todo data has invalid fields, identities, timestamps, priority, or version.' };
	},
	encode(value) { return { version: 1, items: value }; },
};

export function createTodo(text: string, priority: TodoItem['priority'] = 'medium'): TodoItem {
	return { id: crypto.randomUUID(), text: text.trim(), completed: false, createdAt: Date.now(), priority };
}

export const PRIORITY_COLORS: Record<TodoItem['priority'], string> = {
	low: '#6b7280', medium: '#f59e0b', high: '#ef4444',
};

export function todoItemBytes(items: readonly TodoItem[]): number[] {
	const encoder = new TextEncoder();
	return items.map((item) => encoder.encode(JSON.stringify(item)).byteLength);
}
