// goal: Hex Dump core logic

export interface HexChunk {
	offset: string;
	hex: string;
	ascii: string;
}

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
