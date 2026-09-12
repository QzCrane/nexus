import type { OperationConfig } from './config-panel';
import type { PDFOperation } from './types';

export const PDF_WORKER_PATH = 'workers/pdf.js';
export const PDF_TASK_DEADLINE_MS = 30_000;
// A single PDF task owns one worker. These caps keep source bytes, pdf-lib's
// expanded object graph, decoded image RGBA and output bytes within a bounded
// extension-page job while still admitting ordinary multi-document workflows.
export const PDF_MAX_FILES = 16;
export const PDF_MAX_INPUT_BYTES = 64 * 1024 * 1024;
export const PDF_MAX_PAGES = 2_000;
export const PDF_MAX_OUTPUT_BYTES = 128 * 1024 * 1024;
export const PDF_MAX_IMAGE_PIXELS = 64 * 1024 * 1024;

export type PDFInputKind = 'pdf' | 'png' | 'jpeg';

export interface InspectedPDFInput {
	id: string;
	name: string;
	size: number;
	createdAt: number;
	pageCount: number;
	pixelCount: number;
	kind: PDFInputKind;
	file: File;
}

export type PDFWorkerRequest =
	| { type: 'inspect'; files: File[] }
	| {
		type: 'execute';
		operation: PDFOperation;
		inputs: InspectedPDFInput[];
		config: OperationConfig;
	};

export type PDFWorkerResponse =
	| { ok: true; type: 'inspect'; files: InspectedPDFInput[] }
	| { ok: true; type: 'execute'; outputs: ArrayBuffer[] }
	| { ok: false; error: string };
