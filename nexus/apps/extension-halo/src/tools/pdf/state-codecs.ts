import type { ToolStateCodec } from '../../kernel/core/storage-codec';
import type { OperationConfig } from './config-panel';
import type { PDFOperation } from './types';

const OPERATIONS = new Set<PDFOperation>(['merge', 'split', 'extract', 'rotate', 'watermark', 'images-to-pdf']);
const ROTATIONS = new Set([90, 180, 270]);
const PAGE_SIZES = new Set(['A4', 'Letter', 'fit']);

function unwrapVersionOne(value: unknown): unknown {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		&& (value as Record<string, unknown>).version === 1
		? (value as Record<string, unknown>).value
		: value;
}

export const pdfOperationCodec: ToolStateCodec<PDFOperation | null> = {
	decode(value) {
		const raw = unwrapVersionOne(value);
		return raw === null || (typeof raw === 'string' && OPERATIONS.has(raw as PDFOperation))
			? { kind: 'valid', value: raw as PDFOperation | null }
			: { kind: 'invalid', reason: 'Stored PDF operation is unsupported.' };
	},
	encode(value) { return { version: 1, value }; },
};

export const pdfConfigCodec: ToolStateCodec<OperationConfig> = {
	decode(value) {
		const raw = unwrapVersionOne(value);
		if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { kind: 'invalid', reason: 'PDF configuration is not a record.' };
		const config = raw as Record<string, unknown>;
		if (typeof config.splitRanges !== 'string' || config.splitRanges.length > 8_192
			|| typeof config.extractPages !== 'string' || config.extractPages.length > 8_192
			|| typeof config.watermarkText !== 'string' || config.watermarkText.length > 1_000
			|| !ROTATIONS.has(config.rotateDegrees as number)
			|| typeof config.watermarkOpacity !== 'number' || !Number.isFinite(config.watermarkOpacity)
			|| config.watermarkOpacity < 0.1 || config.watermarkOpacity > 1
			|| typeof config.pageSize !== 'string' || !PAGE_SIZES.has(config.pageSize)) {
			return { kind: 'invalid', reason: 'PDF ranges, rotation, watermark, opacity, or page size are invalid.' };
		}
		return { kind: 'valid', value: config as unknown as OperationConfig };
	},
	encode(value) { return { version: 1, value }; },
};
