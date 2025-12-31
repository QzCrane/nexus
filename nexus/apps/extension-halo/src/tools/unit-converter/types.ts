// goal: Unit Converter type definitions

export type UnitCategory = 'length' | 'weight' | 'temperature' | 'time' | 'data';

export interface UnitDef {
	id: string;
	name: string;
	symbol: string;
	toBase: (v: number) => number; // Convert to base unit
	fromBase: (v: number) => number; // Convert from base unit
}
