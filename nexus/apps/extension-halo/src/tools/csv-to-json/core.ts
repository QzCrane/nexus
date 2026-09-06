// goal: CSV to JSON adapter over Papa Parse (R01)
// rule: quoted fields may span lines, cell text is preserved byte-for-byte
// (numeric coercion is an explicit opt-in), duplicate headers keep the tool's
// documented policy, and engine parse errors are surfaced instead of being
// treated as a complete conversion.

import Papa from 'papaparse';

export interface CsvOptions {
	delimiter: string;
	hasHeader: boolean;
	/** Convert cells to numbers when they parse exactly. Default false: fidelity first. */
	coerceNumbers?: boolean;
}

function convertCell(rawValue: string, coerceNumbers: boolean): unknown {
	if (!coerceNumbers) return rawValue;
	if (rawValue === '' || rawValue.trim() !== rawValue) return rawValue;
	const parsed = Number(rawValue);
	// Only exact, finite conversions change type; '007' stays '007'.
	if (Number.isFinite(parsed) && String(parsed) === rawValue) return parsed;
	return rawValue;
}

// Convert CSV to JSON array
export function csvToJson(csv: string, options: CsvOptions = { delimiter: ',', hasHeader: true }): Record<string, unknown>[] {
	const result = Papa.parse<string[]>(csv, {
		delimiter: options.delimiter,
		header: false,
		skipEmptyLines: 'greedy',
		dynamicTyping: false,
	});

	if (result.errors.length > 0) {
		const first = result.errors[0];
		throw new Error(`CSV parse error at row ${(first?.row ?? 0) + 1}: ${first?.message ?? 'unknown'}`);
	}

	const records = result.data;
	if (records.length === 0) return [];

	const coerceNumbers = options.coerceNumbers === true;

	let headers: string[];
	let dataRecords: string[][];

	if (options.hasHeader) {
		const headerRecord = records[0];
		if (!headerRecord) return [];
		headers = headerRecord;
		dataRecords = records.slice(1);
	} else {
		const first = records[0];
		if (!first) return [];
		headers = first.map((_, i) => `col${i + 1}`);
		dataRecords = records;
	}

	const output: Record<string, unknown>[] = [];

	for (const cells of dataRecords) {
		const obj: Record<string, unknown> = {};
		headers.forEach((header, index) => {
			obj[header] = convertCell(cells[index] ?? '', coerceNumbers);
		});
		output.push(obj);
	}

	return output;
}
