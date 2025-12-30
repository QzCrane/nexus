// goal: PDF tool types

export interface PDFDocument {
	id: string;
	name: string;
	pageCount: number;
	size: number;
	createdAt: number;
	data: ArrayBuffer;
}

export interface PDFPage {
	index: number;
	width: number;
	height: number;
	rotation: number;
}

export type PDFOperation =
	| 'merge'
	| 'split'
	| 'extract'
	| 'rotate'
	| 'watermark'
	| 'images-to-pdf'
	| 'pdf-to-images';

export interface MergeOptions {
	documents: ArrayBuffer[];
}

export interface SplitOptions {
	document: ArrayBuffer;
	ranges: { start: number; end: number }[];
}

export interface ExtractOptions {
	document: ArrayBuffer;
	pages: number[];
}

export interface RotateOptions {
	document: ArrayBuffer;
	pages: number[];
	degrees: 90 | 180 | 270;
}

export interface WatermarkOptions {
	document: ArrayBuffer;
	text?: string;
	imageData?: ArrayBuffer;
	opacity?: number;
	position?: 'center' | 'corner' | 'tile';
}

export interface ImagesToPDFOptions {
	images: ArrayBuffer[];
	pageSize?: 'A4' | 'Letter' | 'fit';
}

export type PDFProcessResult<T = ArrayBuffer> = {
	success: true;
	data: T;
	pageCount?: number;
} | {
	success: false;
	error: string;
};

export interface PDFToolState {
	files: PDFDocument[];
	selectedOperation: PDFOperation | null;
	processing: boolean;
	error: string | null;
}
