import type { ColorInfo } from '../color-palette/types';
import type { ExifData } from '../exif-reader/types';
import type { ImageConfig, ImageInfo } from './types';

export const IMAGE_WORKER_PATH = 'workers/image-tools.js';
export const IMAGE_TASK_DEADLINE_MS = 15_000;
// One image is resident per worker job. The byte cap rejects compressed input
// bombs before decode; the pixel cap below bounds the much larger RGBA surface.
export const IMAGE_MAX_INPUT_BYTES = 32 * 1024 * 1024;
// 32 megapixels occupies 128 MiB as RGBA before canvas/output overhead.
export const IMAGE_MAX_DECODED_PIXELS = 32 * 1024 * 1024;
export const IMAGE_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export type ImageWorkerRequest =
	| { type: 'inspect'; file: File }
	| { type: 'process'; file: File; config: ImageConfig }
	| { type: 'palette'; file: File; maxColors: number }
	| { type: 'exif'; file: File };

export type ImageWorkerResponse =
	| { ok: true; type: 'inspect'; info: ImageInfo }
	| { ok: true; type: 'process'; blob: Blob; info: ImageInfo }
	| { ok: true; type: 'palette'; colors: ColorInfo[]; info: ImageInfo }
	| { ok: true; type: 'exif'; data: ExifData }
	| { ok: false; error: string };
