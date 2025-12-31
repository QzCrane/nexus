// goal: Todo List panel UI - task management

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import type { TodoItem } from './types';
import { getTodos, addTodo, toggleTodo, deleteTodo, clearCompleted, PRIORITY_COLORS } from './core';
import { styles } from './panel.styles';

export const TodoListPanel: React.FC = () => {
	const { t } = useTranslation();
	const [todos, setTodos] = useState<TodoItem[]>([]);
	const [input, setInput] = useState('');
	const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all');

	// Load todos
	useEffect(() => {
		getTodos().then(setTodos);
	}, []);

	// Add
	const handleAdd = useCallback(async () => {
		if (!input.trim()) return;
		await addTodo(input);
		setInput('');
		setTodos(await getTodos());
	}, [input]);

	// Toggle
	const handleToggle = useCallback(async (id: string) => {
		await toggleTodo(id);
		setTodos(await getTodos());
	}, []);

	// Delete
	const handleDelete = useCallback(async (id: string) => {
		await deleteTodo(id);
		setTodos(await getTodos());
	}, []);

	// Clear completed
	const handleClearCompleted = useCallback(async () => {
		await clearCompleted();
		setTodos(await getTodos());
	}, []);

	// Filter
	const filtered = todos.filter((t) => {
		if (filter === 'active') return !t.completed;
		if (filter === 'completed') return t.completed;
		return true;
	});

	const activeCount = todos.filter((t) => !t.completed).length;

	return (
		<div style={styles.wrapper}>
			{/* Input */}
			<div style={styles.inputRow}>
				<input
					style={styles.input}
					value={input}
					onChange={(e) => setInput(e.target.value)}
					placeholder={t('todoList.placeholder')}
					onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
				/>
				<button style={styles.btn} onClick={handleAdd}>+</button>
			</div>

			{/* Filter tabs */}
			<div style={{ display: 'flex', gap: '8px' }}>
				{(['all', 'active', 'completed'] as const).map((f) => (
					<button
						key={f}
						style={{ ...styles.deleteBtn, fontWeight: filter === f ? 600 : 400, color: filter === f ? 'var(--halo-accent)' : 'var(--halo-text-muted)' }}
						onClick={() => setFilter(f)}
					>
						{t(`todoList.${f}`)}
					</button>
				))}
			</div>

			{/* List */}
			<div style={styles.list}>
				{filtered.length === 0 ? (
					<div style={styles.empty}>✅ {t('todoList.empty')}</div>
				) : (
					filtered.map((todo) => (
						<div key={todo.id} style={styles.item}>
							<div style={{ ...styles.priority, background: PRIORITY_COLORS[todo.priority] }} />
							<input
								type="checkbox"
								style={styles.checkbox}
								checked={todo.completed}
								onChange={() => handleToggle(todo.id)}
							/>
							<span style={{ ...styles.text, ...(todo.completed ? styles.textCompleted : {}) }}>{todo.text}</span>
							<button style={styles.deleteBtn} onClick={() => handleDelete(todo.id)}>🗑️</button>
						</div>
					))
				)}
			</div>

			{/* Footer */}
			{todos.length > 0 && (
				<div style={styles.footer}>
					<span>{activeCount} {t('todoList.remaining')}</span>
					{todos.some((t) => t.completed) && (
						<button style={styles.deleteBtn} onClick={handleClearCompleted}>{t('todoList.clearCompleted')}</button>
					)}
				</div>
			)}
		</div>
	);
};
