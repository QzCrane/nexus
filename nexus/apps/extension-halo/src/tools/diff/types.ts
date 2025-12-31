// goal: Diff tool type definitions

export interface DiffResult {
	type: 'equal' | 'insert' | 'delete';
	value: string;
}

export interface DiffStats {
	additions: number;
	deletions: number;
	changes: number;
}
