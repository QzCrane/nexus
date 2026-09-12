// goal: Hex Dump core logic

import type { ToolStateCodec } from '../../kernel/core/storage-codec';

export interface HexChunk {
	offset: string;
	hex: string;
	ascii: string;
}

export const hexChunksCodec: ToolStateCodec<HexChunk[]> = {
	decode(value) {
		if (!Array.isArray(value) || value.length > 327_680) return { kind: 'invalid', reason: 'Stored hex dump row count is invalid.' };
		const chunks: HexChunk[] = [];
		for (const item of value) {
			if (typeof item !== 'object' || item === null || Array.isArray(item)) return { kind: 'invalid', reason: 'Stored hex dump contains a non-record row.' };
			const row = item as Record<string, unknown>;
			if (typeof row.offset !== 'string' || !/^[0-9A-F]{8,}$/u.test(row.offset) || typeof row.hex !== 'string' || row.hex.length > 64 || typeof row.ascii !== 'string' || row.ascii.length > 16) {
				return { kind: 'invalid', reason: 'Stored hex dump row fields are invalid.' };
			}
			chunks.push({ offset: row.offset, hex: row.hex, ascii: row.ascii });
		}
		return { kind: 'valid', value: chunks };
	},
	encode: (value) => value,
};

// Convert ArrayBuffer to Hex Dump format
export function createHexDump(buffer: ArrayBuffer, bytesPerLine = 16): HexChunk[] {
	const view = new DataView(buffer);
	const chunks: HexChunk[] = [];

	for (let i = 0; i < buffer.byteLength; i += bytesPerLine) {
		const lineBytes: number[] = [];
		const max = Math.min(bytesPerLine, buffer.byteLength - i);

		for (let j = 0; j < max; j++) {
			lineBytes.push(view.getUint8(i + j));
		}

		const offset = i.toString(16).padStart(8, '0').toUpperCase();

		// Hex part
		const hex = lineBytes
			.map(b => b.toString(16).padStart(2, '0').toUpperCase())
			.join(' ');

		// Padding for last line
		const hexPadded = hex.padEnd(bytesPerLine * 3 - 1, ' ');

		// ASCII part
		const ascii = lineBytes
			.map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.')
			.join('');

		chunks.push({ offset, hex: hexPadded, ascii });
	}

	return chunks;
}
