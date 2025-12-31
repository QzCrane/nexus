// goal: Image Tools type definitions

export type ImageFormat = 'png' | 'jpeg' | 'webp';

export interface ImageConfig {
	quality: number; // 0-1 for jpeg/webp
	maxWidth: number;
	maxHeight: number;
	format: ImageFormat;
}

export interface ImageInfo {
	width: number;
	height: number;
	size: number;
	type: string;
}
