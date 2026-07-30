// goal: CSV Viewer core logic - parse and format CSV

import type { ParsedCsv } from './types';

// Parse CSV string
export function parseCsv(input: string, delimiter = ','): ParsedCsv {
	const lines = input.trim().split(/\r?\n/);
	const [firstLine, ...remainingLines] = lines;
	if (firstLine === undefined) {
		return { headers: [], rows: [], rowCount: 0, colCount: 0 };
	}

	const parseRow = (line: string): string[] => {
		const result: string[] = [];
		let current = '';
		let inQuotes = false;

		for (let i = 0; i < line.length; i++) {
			const char = line[i];
			if (char === '"') {
				if (inQuotes && line[i + 1] === '"') {
					current += '"';
					i++;
				} else {
					inQuotes = !inQuotes;
				}
			} else if (char === delimiter && !inQuotes) {
				result.push(current.trim());
				current = '';
			} else {
				current += char;
			}
		}
		result.push(current.trim());
		return result;
	};

	const headers = parseRow(firstLine);
	const rows = remainingLines.map(parseRow);

	return {
		headers,
		rows,
		rowCount: rows.length,
		colCount: headers.length,
	};
}

// Convert table to CSV string
export function toCsv(headers: string[], rows: string[][], delimiter = ','): string {
	const escapeCsvValue = (val: string): string => {
		if (val.includes(delimiter) || val.includes('"') || val.includes('\n')) {
			return `"${val.replace(/"/g, '""')}"`;
		}
		return val;
	};

	const headerLine = headers.map(escapeCsvValue).join(delimiter);
	const rowLines = rows.map((row) => row.map(escapeCsvValue).join(delimiter));
	return [headerLine, ...rowLines].join('\n');
}

// Auto-detect delimiter
export function detectDelimiter(input: string): string {
	const firstLine = input.split(/\r?\n/)[0] || '';
	const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0, '|': 0 };

	for (const char of firstLine) {
		if (char in counts) counts[char] = (counts[char] ?? 0) + 1;
	}

	const [bestMatch] = Object.entries(counts).sort((a, b) => b[1] - a[1]);
	return bestMatch?.[0] ?? ',';
}
