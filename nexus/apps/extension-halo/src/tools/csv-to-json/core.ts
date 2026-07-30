// goal: CSV to JSON core logic

export interface CsvOptions {
	delimiter: string;
	hasHeader: boolean;
}

// Convert CSV to JSON array
export function csvToJson(csv: string, options: CsvOptions = { delimiter: ',', hasHeader: true }): Record<string, unknown>[] {
	const lines = csv.trim().split(/\r?\n/);
	const firstLine = lines[0];
	if (firstLine === undefined) return [];

	let headers: string[] = [];
	let startRow = 0;

	if (options.hasHeader) {
		headers = parseCsvLine(firstLine, options.delimiter);
		startRow = 1;
	} else {
		// Generate headers: col1, col2, ...
		const firstRow = parseCsvLine(firstLine, options.delimiter);
		headers = firstRow.map((_, i) => `col${i + 1}`);
	}

	const result: Record<string, unknown>[] = [];

	for (let i = startRow; i < lines.length; i++) {
		const sourceLine = lines[i];
		if (sourceLine === undefined) continue;
		const line = sourceLine.trim();
		if (!line) continue;

		const values = parseCsvLine(line, options.delimiter);
		const obj: Record<string, unknown> = {};

		headers.forEach((header, index) => {
			const rawValue = values[index];
			let value: unknown = rawValue;
			// Try to convert numbers/booleans? For now keep strings to be safe or simple conversion
			if (rawValue === 'true') value = true;
			else if (rawValue === 'false') value = false;
			else if (rawValue === 'null') value = null;
			else if (rawValue !== undefined && !Number.isNaN(Number(rawValue)) && rawValue.trim() !== '') value = Number(rawValue);

			obj[header] = value;
		});

		result.push(obj);
	}

	return result;
}

// Parse a single CSV line handling quotes
function parseCsvLine(line: string, delimiter: string): string[] {
	const values: string[] = [];
	let current = '';
	let inQuote = false;

	for (let i = 0; i < line.length; i++) {
		const char = line[i];

		if (char === '"' && line[i + 1] === '"') {
			current += '"';
			i++; // skip next quote
		} else if (char === '"') {
			inQuote = !inQuote;
		} else if (char === delimiter && !inQuote) {
			values.push(current);
			current = '';
		} else {
			current += char;
		}
	}
	values.push(current);

	return values;
}
