// goal: EXIF Reader core logic - parse EXIF from images

import type { ExifData } from './types';

// Parse EXIF from ArrayBuffer (simplified parser for JPEG)
export function parseExif(buffer: ArrayBuffer): ExifData {
	const view = new DataView(buffer);
	const data: ExifData = {};

	// Check JPEG magic bytes
	if (!canRead(view, 0, 2)) return data;
	if (view.getUint16(0) !== 0xFFD8) return data;

	let offset = 2;
	while (canRead(view, offset, 4)) {
		const marker = view.getUint16(offset);
		const segmentLength = view.getUint16(offset + 2);
		if (segmentLength < 2) break;
		const segmentEnd = offset + 2 + segmentLength;
		if (segmentEnd > view.byteLength) break;

		if (marker === 0xFFE1) {
			// APP1 (EXIF)
			const exifStart = offset + 4;

			// Check "Exif\0\0"
			if (
				canRead(view, exifStart, 6, segmentEnd) &&
				view.getUint32(exifStart) === 0x45786966 &&
				view.getUint16(exifStart + 4) === 0x0000
			) {
				const tiffStart = exifStart + 6;
				if (!canRead(view, tiffStart, 8, segmentEnd)) {
					offset = segmentEnd;
					continue;
				}
				const byteOrder = view.getUint16(tiffStart);
				if (byteOrder !== 0x4949 && byteOrder !== 0x4D4D) {
					offset = segmentEnd;
					continue;
				}
				const isLittleEndian = byteOrder === 0x4949;
				if (view.getUint16(tiffStart + 2, isLittleEndian) !== 42) {
					offset = segmentEnd;
					continue;
				}
				const relativeIfdOffset = view.getUint32(tiffStart + 4, isLittleEndian);
				const ifdOffset = tiffStart + relativeIfdOffset;
				if (relativeIfdOffset < 8 || ifdOffset >= segmentEnd) {
					offset = segmentEnd;
					continue;
				}

				parseIFD(
					view,
					tiffStart,
					ifdOffset,
					segmentEnd,
					isLittleEndian,
					data,
				);
				break;
			}
		}
		offset = segmentEnd;
	}

	return data;
}

function canRead(
	view: DataView,
	offset: number,
	byteLength: number,
	end = view.byteLength,
): boolean {
	return Number.isSafeInteger(offset) &&
		Number.isSafeInteger(byteLength) &&
		offset >= 0 &&
		byteLength >= 0 &&
		offset <= end - byteLength &&
		end <= view.byteLength;
}

// Parse IFD (Image File Directory)
function parseIFD(
	view: DataView,
	tiffStart: number,
	ifdOffset: number,
	segmentEnd: number,
	littleEndian: boolean,
	data: ExifData,
): void {
	if (!canRead(view, ifdOffset, 2, segmentEnd)) return;
	const count = view.getUint16(ifdOffset, littleEndian);
	for (let index = 0; index < count; index++) {
		const entryOffset = ifdOffset + 2 + index * 12;
		if (!canRead(view, entryOffset, 12, segmentEnd)) break;
		const tag = view.getUint16(entryOffset, littleEndian);
		const type = view.getUint16(entryOffset + 2, littleEndian);
		const numValues = view.getUint32(entryOffset + 4, littleEndian);
		const valueOffset = entryOffset + 8;

		if (tag === 0xA002 || tag === 0xA003) {
			if (numValues !== 1 || (type !== 3 && type !== 4)) continue;
			const dimension = type === 3
				? view.getUint16(valueOffset, littleEndian)
				: view.getUint32(valueOffset, littleEndian);
			if (tag === 0xA002) data.width = dimension;
			else data.height = dimension;
			continue;
		}

		if (
			tag !== 0x010F &&
			tag !== 0x0110 &&
			tag !== 0x0132 &&
			tag !== 0x0131
		) {
			continue;
		}
		if (type !== 2 || numValues === 0) continue;
		const text = readString(
			view,
			tiffStart,
			valueOffset,
			numValues,
			segmentEnd,
			littleEndian,
		);
		if (text === null) continue;
		switch (tag) {
			case 0x010F: data.make = text; break;
			case 0x0110: data.model = text; break;
			case 0x0132: data.dateTime = text; break;
			case 0x0131: data.software = text; break;
		}
	}
}

// Read string from EXIF
function readString(
	view: DataView,
	tiffStart: number,
	offset: number,
	length: number,
	segmentEnd: number,
	littleEndian: boolean,
): string | null {
	if (!Number.isSafeInteger(length) || length === 0) return null;
	let strOffset = offset;
	if (length > 4) {
		if (!canRead(view, offset, 4, segmentEnd)) return null;
		strOffset = tiffStart + view.getUint32(offset, littleEndian);
	}
	if (strOffset < tiffStart || strOffset >= segmentEnd) return null;

	let str = '';
	const readableLength = Math.min(length - 1, 100, segmentEnd - strOffset);
	for (let index = 0; index < readableLength; index++) {
		const char = view.getUint8(strOffset + index);
		if (char === 0) break;
		str += String.fromCharCode(char);
	}
	return str.trim();
}

// Read file as ArrayBuffer
export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			if (reader.result instanceof ArrayBuffer) resolve(reader.result);
			else reject(new TypeError('FileReader did not return an ArrayBuffer'));
		};
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
