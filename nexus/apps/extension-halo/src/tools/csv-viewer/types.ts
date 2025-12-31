// goal: CSV Viewer type definitions

export interface ParsedCsv {
	headers: string[];
	rows: string[][];
	rowCount: number;
	colCount: number;
}
