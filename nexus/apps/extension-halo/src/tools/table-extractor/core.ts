// goal: Table Extractor core logic - extract tables from page

import type { TableData } from './types';
import type { ToolStateCodec } from '../../kernel/core/storage-codec';
import { serializeCsv, type CsvExportMode } from '../csv-viewer/core';

const MAX_STORED_TABLES = 100;
const MAX_COLUMNS = 256;
const MAX_ROWS_PER_TABLE = 10_000;
const MAX_TOTAL_CELLS = 200_000;

export const tableDataCodec: ToolStateCodec<TableData[]> = {
	decode(value) {
		const raw = typeof value === 'object' && value !== null && !Array.isArray(value)
			&& (value as Record<string, unknown>).version === 1
			? (value as Record<string, unknown>).value
			: value;
		if (!Array.isArray(raw) || raw.length > MAX_STORED_TABLES) return { kind: 'invalid', reason: 'Stored table data must contain at most 100 tables.' };
		let totalCells = 0;
		const tables: TableData[] = [];
		for (const item of raw) {
			if (!item || typeof item !== 'object' || Array.isArray(item)) return { kind: 'invalid', reason: 'Stored table data contains a non-table value.' };
			const table = item as Record<string, unknown>;
			if (!Array.isArray(table.headers) || table.headers.length > MAX_COLUMNS || !table.headers.every((cell) => typeof cell === 'string')) return { kind: 'invalid', reason: 'Stored table headers are invalid.' };
			if (!Array.isArray(table.rows) || table.rows.length > MAX_ROWS_PER_TABLE) return { kind: 'invalid', reason: 'Stored table rows exceed the domain limit.' };
			const rows: string[][] = [];
			for (const row of table.rows) {
				if (!Array.isArray(row) || row.length > MAX_COLUMNS || !row.every((cell) => typeof cell === 'string')) return { kind: 'invalid', reason: 'Stored table data contains an invalid row.' };
				totalCells += row.length;
				if (totalCells > MAX_TOTAL_CELLS) return { kind: 'invalid', reason: 'Stored table data exceeds the total cell limit.' };
				rows.push([...row]);
			}
			if (table.caption !== undefined && typeof table.caption !== 'string') return { kind: 'invalid', reason: 'Stored table caption is invalid.' };
			tables.push({ headers: [...table.headers] as string[], rows, ...(typeof table.caption === 'string' ? { caption: table.caption } : {}) });
		}
		return { kind: 'valid', value: tables };
	},
	encode(value) { return { version: 1, value }; },
};

// Extract all tables from current page
export async function extractTables(): Promise<TableData[]> {
	try {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		if (!tab?.id) return [];

		const [result] = await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			func: () => {
				const tables: Array<{ headers: string[]; rows: string[][]; caption?: string }> = [];

				document.querySelectorAll('table').forEach((table) => {
					const caption = table.querySelector('caption')?.textContent?.trim();
					const headers: string[] = [];
					const rows: string[][] = [];

					// Extract headers
					const headerCells = table.querySelectorAll('thead th, thead td, tr:first-child th');
					headerCells.forEach((cell) => {
						headers.push(cell.textContent?.trim() || '');
					});

					// Extract rows
					const dataRows = table.querySelectorAll('tbody tr, tr');
					dataRows.forEach((row, i) => {
						// Skip header row if headers exist
						if (i === 0 && headers.length > 0 && row.querySelector('th')) return;

						const cells: string[] = [];
						row.querySelectorAll('td, th').forEach((cell) => {
							cells.push(cell.textContent?.trim() || '');
						});
						if (cells.length > 0) rows.push(cells);
					});

					if (rows.length > 0 || headers.length > 0) {
						tables.push({ headers, rows, caption });
					}
				});

				return tables;
			},
		});

		return result?.result || [];
	} catch {
		return [];
	}
}

// Convert table to CSV
export function tableToCsv(table: TableData, exportMode: CsvExportMode = 'raw'): string {
	return serializeCsv(table.headers, table.rows, ',', exportMode);
}

// Convert table to JSON
export function tableToJson(table: TableData): string {
	if (table.headers.length === 0) return JSON.stringify(table.rows, null, 2);

	const objects = table.rows.map((row) => {
		const obj: Record<string, string> = {};
		table.headers.forEach((h, i) => { obj[h || `col${i}`] = row[i] || ''; });
		return obj;
	});

	return JSON.stringify(objects, null, 2);
}
