// goal: EXIF Reader core logic - parse EXIF from images

import type { ExifData } from './types';

// Parse EXIF from ArrayBuffer (simplified parser for JPEG)
export function parseExif(buffer: ArrayBuffer): ExifData {
	const view = new DataView(buffer);
	const data: ExifData = {};

	// Check JPEG magic bytes
	if (view.getUint16(0) !== 0xFFD8) return data;

	let offset = 2;
	while (offset < view.byteLength - 2) {
		const marker = view.getUint16(offset);
		if (marker === 0xFFE1) {
			// APP1 (EXIF)
			const length = view.getUint16(offset + 2);
			const exifStart = offset + 4;

			// Check "Exif\0\0"
			if (view.getUint32(exifStart) === 0x45786966 && view.getUint16(exifStart + 4) === 0x0000) {
				const tiffStart = exifStart + 6;
				const isLittleEndian = view.getUint16(tiffStart) === 0x4949;
				const ifdOffset = view.getUint32(tiffStart + 4, isLittleEndian);

				parseIFD(view, tiffStart, tiffStart + ifdOffset, isLittleEndian, data);
			}
			break;
		}
		offset += 2 + view.getUint16(offset + 2);
	}

	return data;
}

// Parse IFD (Image File Directory)
function parseIFD(view: DataView, tiffStart: number, ifdOffset: number, le: boolean, data: ExifData) {
	try {
		const count = view.getUint16(ifdOffset, le);
		for (let i = 0; i < count; i++) {
			const entryOffset = ifdOffset + 2 + i * 12;
			const tag = view.getUint16(entryOffset, le);
			const type = view.getUint16(entryOffset + 2, le);
			const numValues = view.getUint32(entryOffset + 4, le);
			const valueOffset = entryOffset + 8;

			switch (tag) {
				case 0x010F: data.make = readString(view, tiffStart, valueOffset, numValues, le); break;
				case 0x0110: data.model = readString(view, tiffStart, valueOffset, numValues, le); break;
				case 0x0132: data.dateTime = readString(view, tiffStart, valueOffset, numValues, le); break;
				case 0x0131: data.software = readString(view, tiffStart, valueOffset, numValues, le); break;
				case 0xA002: data.width = type === 3 ? view.getUint16(valueOffset, le) : view.getUint32(valueOffset, le); break;
				case 0xA003: data.height = type === 3 ? view.getUint16(valueOffset, le) : view.getUint32(valueOffset, le); break;
			}
		}
	} catch { /* ignore parse errors */ }
}

// Read string from EXIF
function readString(view: DataView, tiffStart: number, offset: number, length: number, le: boolean): string {
	let strOffset = offset;
	if (length > 4) strOffset = tiffStart + view.getUint32(offset, le);

	let str = '';
	for (let i = 0; i < Math.min(length - 1, 100); i++) {
		const char = view.getUint8(strOffset + i);
		if (char === 0) break;
		str += String.fromCharCode(char);
	}
	return str.trim();
}

// Read file as ArrayBuffer
export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as ArrayBuffer);
		reader.onerror = reject;
		reader.readAsArrayBuffer(file);
	});
}

// Format file size
export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1048576).toFixed(1)} MB`;
}
