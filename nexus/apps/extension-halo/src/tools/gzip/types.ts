// goal: Gzip types

export interface GzipResult {
	output: string;
	originalSize: number;
	compressedSize: number;
	ratio: number;
}
