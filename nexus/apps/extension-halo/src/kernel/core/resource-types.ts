// goal: Resource Manager Types
// eff: Extracted from resource-manager.ts

export interface ResourceMetadata {
	id: string;
	url: string;
	hash: string;
	size: number;
	type: 'wasm' | 'model' | 'script' | 'data';
	downloadedAt: number;
}

export interface ResourceEntry extends ResourceMetadata {
	data: ArrayBuffer;
}

export type DownloadProgress = {
	loaded: number;
	total: number;
	percent: number;
}
