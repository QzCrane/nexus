// goal: Mock data generation core logic (lightweight, no external deps)

import type { MockDataType, MockField, MockConfig } from './types';
import type { ToolStateCodec } from '../../kernel/core/storage-codec';

const MOCK_DATA_TYPES = new Set<MockDataType>(['name', 'email', 'phone', 'uuid', 'address', 'lorem', 'number', 'date']);
export const mockFieldsCodec: ToolStateCodec<MockField[]> = {
	decode(value) {
		if (!Array.isArray(value) || value.length > 100 || value.some((entry) => {
			if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return true;
			const field = entry as Record<string, unknown>;
			return typeof field.name !== 'string' || typeof field.type !== 'string'
				|| !MOCK_DATA_TYPES.has(field.type as MockDataType);
		})) return { kind: 'invalid', reason: 'Mock fields contain invalid names or types.' };
		// The read boundary is where legacy persisted rows (pre-identity era) and
		// accidental duplicates are upgraded to stable identities exactly once.
		return { kind: 'valid', value: normalizeMockFields(value as MockField[]) };
	},
	encode(value) { return value; },
};

export const mockCountCodec: ToolStateCodec<number> = {
	decode(value) { return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 1000 ? { kind: 'valid', value: value as number } : { kind: 'invalid', reason: 'Mock row count must be an integer from 1 to 1000.' }; },
	encode(value) { return value; },
};

export const mockFormatCodec: ToolStateCodec<MockConfig['format']> = {
	decode(value) { return value === 'json' || value === 'csv' || value === 'sql' ? { kind: 'valid', value } : { kind: 'invalid', reason: 'Mock output format is unsupported.' }; },
	encode(value) { return value; },
};

// Predefined data pools
const FIRST_NAMES = ['James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda', 'William', 'Elizabeth', 'David', 'Susan', 'Richard', 'Jessica', 'Joseph', 'Sarah'] as const;
const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas'] as const;
const EMAIL_DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'example.com', 'test.org'] as const;
const LOREM_WORDS = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore', 'magna', 'aliqua'] as const;
const STREETS = ['Main St', 'Oak Ave', 'Pine Rd', 'Maple Dr', 'Cedar Ln', 'Elm Blvd', 'Park Way', 'River Rd'] as const;
const CITIES = ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia', 'San Antonio', 'San Diego'] as const;

// Random utilities
const pick = <T>(arr: readonly [T, ...T[]]): T => arr[Math.floor(Math.random() * arr.length)] ?? arr[0];
const randInt = (min: number, max: number): number => Math.floor(Math.random() * (max - min + 1)) + min;

export function createMockField(name: string, type: MockDataType): MockField {
	return { id: crypto.randomUUID(), name, type };
}

/** Upgrade persisted editable rows to stable identities while preserving valid IDs. */
export function normalizeMockFields(fields: MockField[]): MockField[] {
	const seen = new Set<string>();
	let changed = false;
	const normalized = fields.map((field) => {
		if (field.id && !seen.has(field.id)) {
			seen.add(field.id);
			return field;
		}

		changed = true;
		const id = crypto.randomUUID();
		seen.add(id);
		return { ...field, id };
	});
	return changed ? normalized : fields;
}

// Generate single value by type
export function generateValue(type: MockDataType): string | number {
	switch (type) {
		case 'name':
			return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
		case 'email': {
			const name = pick(FIRST_NAMES).toLowerCase();
			return `${name}${randInt(1, 999)}@${pick(EMAIL_DOMAINS)}`;
		}
		case 'phone':
			return `+1-${randInt(200, 999)}-${randInt(100, 999)}-${randInt(1000, 9999)}`;
		case 'uuid':
			return crypto.randomUUID();
		case 'address':
			return `${randInt(1, 9999)} ${pick(STREETS)}, ${pick(CITIES)}`;
		case 'lorem': {
			const count = randInt(5, 15);
			return Array.from({ length: count }, () => pick(LOREM_WORDS)).join(' ');
		}
		case 'number':
			return randInt(1, 10000);
		case 'date': {
			const start = new Date(2020, 0, 1).getTime();
			const end = Date.now();
			return new Date(randInt(start, end)).toISOString().split('T')[0] ?? '';
		}
		default:
			return '';
	}
}

// Generate single record
export function generateRecord(fields: MockField[]): Record<string, string | number> {
	const record: Record<string, string | number> = {};
	for (const field of fields) {
		record[field.name] = generateValue(field.type);
	}
	return record;
}

// Generate dataset
export function generateDataset(config: MockConfig): Record<string, string | number>[] {
	return Array.from({ length: config.count }, () => generateRecord(config.fields));
}

// Format as JSON
export function formatJSON(data: Record<string, string | number>[]): string {
	return JSON.stringify(data, null, 2);
}

// Format as CSV
export function formatCSV(data: Record<string, string | number>[]): string {
	const firstRow = data[0];
	if (!firstRow) return '';
	const headers = Object.keys(firstRow);
	const rows = data.map((row) => headers.map((h) => `"${String(row[h]).replace(/"/g, '""')}"`).join(','));
	return [headers.join(','), ...rows].join('\n');
}

// Format as SQL INSERT
export function formatSQL(data: Record<string, string | number>[], tableName = 'mock_data'): string {
	const firstRow = data[0];
	if (!firstRow) return '';
	const headers = Object.keys(firstRow);
	const values = data.map((row) => {
		const vals = headers.map((h) => {
			const v = row[h];
			return typeof v === 'number' ? v : `'${String(v).replace(/'/g, "''")}'`;
		});
		return `(${vals.join(', ')})`;
	});
	return `INSERT INTO ${tableName} (${headers.join(', ')}) VALUES\n${values.join(',\n')};`;
}

// Main export function
export function generateMockData(config: MockConfig): string {
	const data = generateDataset(config);
	switch (config.format) {
		case 'csv': return formatCSV(data);
		case 'sql': return formatSQL(data);
		default: return formatJSON(data);
	}
}
