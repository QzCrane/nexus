
export interface Marker {
	id: string;
	el: HTMLElement;
	n: number;
	baseN: number;
	dotElement: HTMLElement | null;
	summary: string;
	starred: boolean;
}

export interface VisibleRange {
	start: number;
	end: number;
}
