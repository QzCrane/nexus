// goal: Ruler tool type definitions

export interface RulerMeasurement {
	startX: number;
	startY: number;
	endX: number;
	endY: number;
	width: number;
	height: number;
	diagonal: number;
}

export interface RulerState {
	isActive: boolean;
	measurement: RulerMeasurement | null;
	unit: 'px' | 'rem';
	remBase: number;
}

export const STORAGE_KEY = 'HALO_RULER_SETTINGS';

export const DEFAULT_STATE: Omit<RulerState, 'isActive' | 'measurement'> = {
	unit: 'px',
	remBase: 16,
};
