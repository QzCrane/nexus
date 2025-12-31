// goal: Sticky Notes type definitions

export interface Note {
	id: string;
	content: string;
	color: string;
	createdAt: number;
	updatedAt: number;
}

export const NOTE_COLORS = [
	{ id: 'yellow', bg: '#fef3c7', text: '#92400e' },
	{ id: 'green', bg: '#d1fae5', text: '#065f46' },
	{ id: 'blue', bg: '#dbeafe', text: '#1e40af' },
	{ id: 'pink', bg: '#fce7f3', text: '#9d174d' },
	{ id: 'purple', bg: '#ede9fe', text: '#5b21b6' },
];
