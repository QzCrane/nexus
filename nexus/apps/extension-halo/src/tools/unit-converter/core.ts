// goal: Unit Converter core logic - unit definitions and conversion

import type { UnitCategory, UnitDef } from './types';

// Unit definitions by category
export const UNITS: Record<UnitCategory, UnitDef[]> = {
	length: [
		{ id: 'mm', name: 'Millimeter', symbol: 'mm', toBase: (v) => v / 1000, fromBase: (v) => v * 1000 },
		{ id: 'cm', name: 'Centimeter', symbol: 'cm', toBase: (v) => v / 100, fromBase: (v) => v * 100 },
		{ id: 'm', name: 'Meter', symbol: 'm', toBase: (v) => v, fromBase: (v) => v },
		{ id: 'km', name: 'Kilometer', symbol: 'km', toBase: (v) => v * 1000, fromBase: (v) => v / 1000 },
		{ id: 'in', name: 'Inch', symbol: 'in', toBase: (v) => v * 0.0254, fromBase: (v) => v / 0.0254 },
		{ id: 'ft', name: 'Foot', symbol: 'ft', toBase: (v) => v * 0.3048, fromBase: (v) => v / 0.3048 },
		{ id: 'yd', name: 'Yard', symbol: 'yd', toBase: (v) => v * 0.9144, fromBase: (v) => v / 0.9144 },
		{ id: 'mi', name: 'Mile', symbol: 'mi', toBase: (v) => v * 1609.344, fromBase: (v) => v / 1609.344 },
	],
	weight: [
		{ id: 'mg', name: 'Milligram', symbol: 'mg', toBase: (v) => v / 1000000, fromBase: (v) => v * 1000000 },
		{ id: 'g', name: 'Gram', symbol: 'g', toBase: (v) => v / 1000, fromBase: (v) => v * 1000 },
		{ id: 'kg', name: 'Kilogram', symbol: 'kg', toBase: (v) => v, fromBase: (v) => v },
		{ id: 't', name: 'Metric Ton', symbol: 't', toBase: (v) => v * 1000, fromBase: (v) => v / 1000 },
		{ id: 'oz', name: 'Ounce', symbol: 'oz', toBase: (v) => v * 0.0283495, fromBase: (v) => v / 0.0283495 },
		{ id: 'lb', name: 'Pound', symbol: 'lb', toBase: (v) => v * 0.453592, fromBase: (v) => v / 0.453592 },
	],
	temperature: [
		{ id: 'c', name: 'Celsius', symbol: '°C', toBase: (v) => v, fromBase: (v) => v },
		{ id: 'f', name: 'Fahrenheit', symbol: '°F', toBase: (v) => (v - 32) * 5 / 9, fromBase: (v) => v * 9 / 5 + 32 },
		{ id: 'k', name: 'Kelvin', symbol: 'K', toBase: (v) => v - 273.15, fromBase: (v) => v + 273.15 },
	],
	time: [
		{ id: 'ms', name: 'Millisecond', symbol: 'ms', toBase: (v) => v / 1000, fromBase: (v) => v * 1000 },
		{ id: 's', name: 'Second', symbol: 's', toBase: (v) => v, fromBase: (v) => v },
		{ id: 'min', name: 'Minute', symbol: 'min', toBase: (v) => v * 60, fromBase: (v) => v / 60 },
		{ id: 'h', name: 'Hour', symbol: 'h', toBase: (v) => v * 3600, fromBase: (v) => v / 3600 },
		{ id: 'd', name: 'Day', symbol: 'd', toBase: (v) => v * 86400, fromBase: (v) => v / 86400 },
		{ id: 'wk', name: 'Week', symbol: 'wk', toBase: (v) => v * 604800, fromBase: (v) => v / 604800 },
	],
	data: [
		{ id: 'b', name: 'Byte', symbol: 'B', toBase: (v) => v, fromBase: (v) => v },
		{ id: 'kb', name: 'Kilobyte', symbol: 'KB', toBase: (v) => v * 1024, fromBase: (v) => v / 1024 },
		{ id: 'mb', name: 'Megabyte', symbol: 'MB', toBase: (v) => v * 1048576, fromBase: (v) => v / 1048576 },
		{ id: 'gb', name: 'Gigabyte', symbol: 'GB', toBase: (v) => v * 1073741824, fromBase: (v) => v / 1073741824 },
		{ id: 'tb', name: 'Terabyte', symbol: 'TB', toBase: (v) => v * 1099511627776, fromBase: (v) => v / 1099511627776 },
	],
};

// Convert value between units
export function convertUnit(value: number, fromUnit: UnitDef, toUnit: UnitDef): number {
	const baseValue = fromUnit.toBase(value);
	return toUnit.fromBase(baseValue);
}

// Get all units in a category
export function getUnits(category: UnitCategory): UnitDef[] {
	return UNITS[category] || [];
}

// Format result with appropriate precision
export function formatResult(value: number): string {
	if (Math.abs(value) >= 1000000 || (Math.abs(value) < 0.001 && value !== 0)) {
		return value.toExponential(6);
	}
	return value.toPrecision(10).replace(/\.?0+$/, '');
}

// Category labels
export const CATEGORY_LABELS: Record<UnitCategory, string> = {
	length: '📏 Length',
	weight: '⚖️ Weight',
	temperature: '🌡️ Temperature',
	time: '⏱️ Time',
	data: '💾 Data',
};
