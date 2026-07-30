// goal: Table Extractor core logic - extract tables from page

import type { TableData } from './types';

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
export function tableToCsv(table: TableData): string {
	const escapeCsvValue = (val: string): string => {
		if (val.includes(',') || val.includes('"') || val.includes('\n')) {
			return `"${val.replace(/"/g, '""')}"`;
		}
		return val;
	};

	const lines: string[] = [];
	if (table.headers.length > 0) {
		lines.push(table.headers.map(escapeCsvValue).join(','));
	}
	table.rows.forEach((row) => {
		lines.push(row.map(escapeCsvValue).join(','));
	});

	return lines.join('\n');
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
