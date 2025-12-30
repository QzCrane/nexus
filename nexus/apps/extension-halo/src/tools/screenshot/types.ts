
// goal: Screenshot tool types
// scope: module

export type CaptureType = 'visible' | 'area';

export interface ScreenshotState {
	image: string | null; // Data URL
	loading: boolean;
	error: string | null;
}
