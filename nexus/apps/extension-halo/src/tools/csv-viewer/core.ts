// goal: CSV Viewer adapter over Papa Parse (R01)
// rule: the generic CSV parsing/serializing algorithm belongs to the maintained
// engine. This adapter owns the tool contract: header-first table shape, row
// and column counts, and the failure semantics — parse errors are surfaced,
// never silently treated as a complete success.

import Papa from 'papaparse';
import type { ToolStateCodec } from '../../kernel/core/storage-codec';
import type { ParsedCsv } from './types';

export type CsvExportMode = 'raw' | 'spreadsheet-safe';
export const csvExportModeCodec: ToolStateCodec<CsvExportMode> = {
	decode(value) {
		return value === 'raw' || value === 'spreadsheet-safe'
			? { kind: 'valid', value }
			: { kind: 'invalid', reason: 'CSV export mode is unsupported.' };
	},
	encode(value) { return value; },
};

// Parse CSV string
export function parseCsv(input: string, delimiter = ','): ParsedCsv {
	const result = Papa.parse<string[]>(input, {
		delimiter,
		header: false,
		skipEmptyLines: false,
		// Cell text is preserved byte-for-byte; the viewer applies no typing.
		dynamicTyping: false,
	});

	if (result.errors.length > 0) {
		const first = result.errors[0];
		throw new Error(`CSV parse error at row ${(first?.row ?? 0) + 1}: ${first?.message ?? 'unknown'}`);
	}

	const rows = result.data;
	const headerRow = rows[0];
	if (!headerRow) {
		return { headers: [], rows: [], rowCount: 0, colCount: 0 };
	}
	const dataRows = rows.slice(1);

	return {
		headers: headerRow,
		rows: dataRows,
		rowCount: dataRows.length,
		colCount: headerRow.length,
	};
}

/**
 * Serialize CSV through the one admitted engine. Raw mode is the fidelity
 * default. Spreadsheet-safe mode is explicit because it prefixes formula-like
 * cells with an apostrophe and therefore changes their field text.
 */
export function serializeCsv(
	headers: string[],
	rows: string[][],
	delimiter = ',',
	mode: CsvExportMode = 'raw',
): string {
	return Papa.unparse(
		{ fields: headers, data: rows },
		{
			delimiter,
			newline: '\n',
			escapeFormulae: mode === 'spreadsheet-safe',
		},
	);
}

// Auto-detect delimiter (tool-level hint for the engine, not a parser)
export function detectDelimiter(input: string): string {
	const firstLine = input.split(/\r?\n/)[0] || '';
	const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0, '|': 0 };

	for (const char of firstLine) {
		if (char in counts) counts[char] = (counts[char] ?? 0) + 1;
	}

	const [bestMatch] = Object.entries(counts).sort((a, b) => b[1] - a[1]);
	return bestMatch?.[0] ?? ',';
}
