// goal: Todo List core logic - CRUD operations with persistence

import type { TodoItem } from './types';

const STORAGE_KEY = 'halo_todo_list';

// Get all todos
export async function getTodos(): Promise<TodoItem[]> {
	const result = await chrome.storage.local.get(STORAGE_KEY);
	return result[STORAGE_KEY] || [];
}

// Save todos
async function saveTodos(todos: TodoItem[]): Promise<void> {
	await chrome.storage.local.set({ [STORAGE_KEY]: todos });
}

// Add todo
export async function addTodo(text: string, priority: TodoItem['priority'] = 'medium'): Promise<TodoItem> {
	const todos = await getTodos();
	const newTodo: TodoItem = {
		id: crypto.randomUUID(),
		text: text.trim(),
		completed: false,
		createdAt: Date.now(),
		priority,
	};
	todos.unshift(newTodo);
	await saveTodos(todos);
	return newTodo;
}

// Update todo
export async function updateTodo(id: string, updates: Partial<TodoItem>): Promise<void> {
	const todos = await getTodos();
	const index = todos.findIndex((t) => t.id === id);
	if (index >= 0) {
		todos[index] = { ...todos[index], ...updates };
		await saveTodos(todos);
	}
}

// Delete todo
export async function deleteTodo(id: string): Promise<void> {
	const todos = await getTodos();
	await saveTodos(todos.filter((t) => t.id !== id));
}

// Toggle completed
export async function toggleTodo(id: string): Promise<void> {
	const todos = await getTodos();
	const todo = todos.find((t) => t.id === id);
	if (todo) {
		todo.completed = !todo.completed;
		await saveTodos(todos);
	}
}

// Clear completed
export async function clearCompleted(): Promise<void> {
	const todos = await getTodos();
	await saveTodos(todos.filter((t) => !t.completed));
}

// Priority colors
export const PRIORITY_COLORS: Record<TodoItem['priority'], string> = {
	low: '#6b7280',
	medium: '#f59e0b',
	high: '#ef4444',
};
