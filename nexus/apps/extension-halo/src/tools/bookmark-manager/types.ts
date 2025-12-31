// goal: Bookmark Manager type definitions

export interface BookmarkNode {
	id: string;
	title: string;
	url?: string;
	parentId?: string;
	dateAdded?: number;
	children?: BookmarkNode[];
}

export interface BookmarkSearchResult {
	id: string;
	title: string;
	url: string;
	parentTitle: string;
}
