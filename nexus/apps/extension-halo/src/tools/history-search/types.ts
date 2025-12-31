// goal: History Search type definitions

export interface HistoryItem {
	id: string;
	url: string;
	title: string;
	lastVisitTime: number;
	visitCount: number;
}
