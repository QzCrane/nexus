// goal: Todo List panel UI - task management

import type React from 'react';
import { useCallback } from 'react';
import { useTranslation } from '../../i18n';
import type { TodoItem } from './types';
import { createTodo, PRIORITY_COLORS, TODO_STORAGE_KEY, TODO_QUOTA_POLICY, todoItemBytes, todoListCodec } from './core';
import { styles } from './panel.styles';
import { useToolState } from '../../kernel';
import type { ToolStateCodec } from '../../kernel/core/storage-codec';
import { StorageRecoveryActions } from '../../components/sidepanel/StorageRecoveryActions';

type TodoFilter = 'all' | 'active' | 'completed';
const todoFilterCodec: ToolStateCodec<TodoFilter> = {
	decode(value) { return value === 'all' || value === 'active' || value === 'completed' ? { kind: 'valid', value } : { kind: 'invalid', reason: 'Todo filter is unsupported.' }; },
	encode(value) { return value; },
};


export const TodoListPanel: React.FC = () => {
	const { t } = useTranslation();
	const [todos, setTodos, , recovery] = useToolState<TodoItem[]>('todo-list', [], {
		storageKey: TODO_STORAGE_KEY,
		codec: todoListCodec,
		quota: TODO_QUOTA_POLICY,
		quotaItemBytes: todoItemBytes,
	});
	const [input, setInput] = useToolState<string>('todo-input', '');
	const [filter, setFilter, , filterRecovery] = useToolState<TodoFilter>('todo-filter', 'all', { codec: todoFilterCodec });


	// Add
	const handleAdd = useCallback(() => {
		if (!input.trim()) return;
		setTodos((current) => [createTodo(input), ...current]);
		setInput('');
	}, [input, setInput, setTodos]);

	// Toggle
	const handleToggle = useCallback((id: string) => setTodos((current) => current.map((todo) => todo.id === id ? { ...todo, completed: !todo.completed } : todo)), [setTodos]);

	// Delete
	const handleDelete = useCallback((id: string) => setTodos((current) => current.filter((todo) => todo.id !== id)), [setTodos]);

	// Clear completed
	const handleClearCompleted = useCallback(() => setTodos((current) => current.filter((todo) => !todo.completed)), [setTodos]);

	// Filter
	const filtered = todos.filter((t) => {
		if (filter === 'active') return !t.completed;
		if (filter === 'completed') return t.completed;
		return true;
	});

	const activeCount = todos.filter((t) => !t.completed).length;

	return (
		<div style={styles.wrapper}>
			<StorageRecoveryActions recovery={recovery} emptyValue={[]} exportName="halo-todo-recovery.json" />
			<StorageRecoveryActions recovery={filterRecovery} emptyValue="all" exportName="halo-todo-filter-damaged.json" />
			{/* Input */}
			<div style={styles.inputRow}>
				<input
					style={styles.input}
					value={input}
					onChange={(e) => setInput(e.target.value)}
					placeholder={t('todoList.placeholder')}
					onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
				/>
				<button type="button" style={styles.btn} onClick={handleAdd}>+</button>
			</div>

			{/* Filter tabs */}
			<div style={{ display: 'flex', gap: '8px' }}>
				{(['all', 'active', 'completed'] as const).map((f) => (
					<button type="button"
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
							<button type="button" style={styles.deleteBtn} onClick={() => handleDelete(todo.id)}>🗑️</button>
						</div>
					))
				)}
			</div>

			{/* Footer */}
			{todos.length > 0 && (
				<div style={styles.footer}>
					<span>{activeCount} {t('todoList.remaining')}</span>
					{todos.some((t) => t.completed) && (
						<button type="button" style={styles.deleteBtn} onClick={handleClearCompleted}>{t('todoList.clearCompleted')}</button>
					)}
				</div>
			)}
		</div>
	);
};
