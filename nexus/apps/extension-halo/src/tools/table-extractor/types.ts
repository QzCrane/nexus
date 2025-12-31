// goal: Table Extractor type definitions

export interface TableData {
	headers: string[];
	rows: string[][];
	caption?: string;
}
