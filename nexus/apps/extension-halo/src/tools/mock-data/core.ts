// goal: Mock data generation core logic (lightweight, no external deps)

import type { MockDataType, MockField, MockConfig } from './types';

// Predefined data pools
const FIRST_NAMES = ['James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda', 'William', 'Elizabeth', 'David', 'Susan', 'Richard', 'Jessica', 'Joseph', 'Sarah'];
const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas'];
const EMAIL_DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'example.com', 'test.org'];
const LOREM_WORDS = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore', 'magna', 'aliqua'];
const STREETS = ['Main St', 'Oak Ave', 'Pine Rd', 'Maple Dr', 'Cedar Ln', 'Elm Blvd', 'Park Way', 'River Rd'];
const CITIES = ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia', 'San Antonio', 'San Diego'];

// Random utilities
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min: number, max: number): number => Math.floor(Math.random() * (max - min + 1)) + min;

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
			return new Date(randInt(start, end)).toISOString().split('T')[0];
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
	if (data.length === 0) return '';
	const headers = Object.keys(data[0]);
	const rows = data.map((row) => headers.map((h) => `"${String(row[h]).replace(/"/g, '""')}"`).join(','));
	return [headers.join(','), ...rows].join('\n');
}

// Format as SQL INSERT
export function formatSQL(data: Record<string, string | number>[], tableName = 'mock_data'): string {
	if (data.length === 0) return '';
	const headers = Object.keys(data[0]);
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
