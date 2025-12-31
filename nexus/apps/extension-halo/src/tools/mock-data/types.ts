// goal: Mock data generator type definitions

export type MockDataType = 'name' | 'email' | 'phone' | 'uuid' | 'address' | 'lorem' | 'number' | 'date';

export interface MockField {
	name: string;
	type: MockDataType;
}

export interface MockConfig {
	fields: MockField[];
	count: number;
	format: 'json' | 'csv' | 'sql';
}
