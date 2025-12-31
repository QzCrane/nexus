// goal: Todo List type definitions

export interface TodoItem {
	id: string;
	text: string;
	completed: boolean;
	createdAt: number;
	priority: 'low' | 'medium' | 'high';
}
