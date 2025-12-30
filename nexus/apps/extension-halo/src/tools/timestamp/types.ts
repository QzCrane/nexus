// goal: Timestamp tool type definitions

export type TimestampUnit = 's' | 'ms' | 'us' | 'ns';

export interface TimestampState {
	current: number;
	input: string;
	output: string;
	unit: TimestampUnit;
	isDateToTs: boolean; // false: TS -> Date, true: Date -> TS
}
