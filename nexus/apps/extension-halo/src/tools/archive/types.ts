// goal: Archive tool type definitions

export interface ArchiveEntry {
	id: string;
	title: string;
	url: string;
	savedAt: number;
	size: number;
	mhtmlBlob?: Blob;
}

export interface ArchiveState {
	entries: ArchiveEntry[];
	isCapturing: boolean;
}
