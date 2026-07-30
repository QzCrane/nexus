import { describe, expect, test } from 'bun:test';
import { parseExif } from '../src/tools/exif-reader/core';

function bytes(...values: number[]): ArrayBuffer {
	return Uint8Array.from(values).buffer;
}

function app1Segment(payload: Uint8Array): Uint8Array {
	const length = payload.length + 2;
	return Uint8Array.from([
		0xFF,
		0xE1,
		length >>> 8,
		length & 0xFF,
		...payload,
	]);
}

function createExifJpeg(options: {
	littleEndian: boolean;
	tiffMagic?: number;
	dimensionType?: number;
	leadingNonExifApp1?: boolean;
}): ArrayBuffer {
	const {
		littleEndian,
		tiffMagic = 42,
		dimensionType = 3,
		leadingNonExifApp1 = false,
	} = options;
	const tiff = new Uint8Array(8 + 2 + 24 + 4);
	const view = new DataView(tiff.buffer);
	view.setUint16(0, littleEndian ? 0x4949 : 0x4D4D);
	view.setUint16(2, tiffMagic, littleEndian);
	view.setUint32(4, 8, littleEndian);
	view.setUint16(8, 2, littleEndian);

	const makeEntry = 10;
	view.setUint16(makeEntry, 0x010F, littleEndian);
	view.setUint16(makeEntry + 2, 2, littleEndian);
	view.setUint32(makeEntry + 4, 4, littleEndian);
	tiff.set([0x43, 0x61, 0x6D, 0x00], makeEntry + 8);

	const widthEntry = makeEntry + 12;
	view.setUint16(widthEntry, 0xA002, littleEndian);
	view.setUint16(widthEntry + 2, dimensionType, littleEndian);
	view.setUint32(widthEntry + 4, 1, littleEndian);
	if (dimensionType === 3) {
		view.setUint16(widthEntry + 8, 640, littleEndian);
	} else {
		view.setUint32(widthEntry + 8, 640, littleEndian);
	}

	const exifPayload = Uint8Array.from([
		0x45,
		0x78,
		0x69,
		0x66,
		0x00,
		0x00,
		...tiff,
	]);
	const leading = leadingNonExifApp1
		? app1Segment(Uint8Array.from([0x58, 0x4D, 0x50, 0x00]))
		: new Uint8Array();
	return Uint8Array.from([
		0xFF,
		0xD8,
		...leading,
		...app1Segment(exifPayload),
	]).buffer;
}

describe('EXIF reader bounds', () => {
	test('returns an empty result for truncated input without throwing', () => {
		expect(parseExif(new ArrayBuffer(0))).toEqual({});
		expect(parseExif(bytes(0xFF))).toEqual({});
		expect(parseExif(bytes(0xFF, 0xD8, 0xFF, 0xE1))).toEqual({});
	});

	test('rejects an APP1 length that extends beyond the file', () => {
		const malformed = bytes(
			0xFF, 0xD8,
			0xFF, 0xE1, 0x00, 0x20,
			0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
		);

		expect(parseExif(malformed)).toEqual({});
	});

	test('parses bounded little-endian and big-endian TIFF entries', () => {
		expect(parseExif(createExifJpeg({ littleEndian: true }))).toEqual({
			make: 'Cam',
			width: 640,
		});
		expect(parseExif(createExifJpeg({
			littleEndian: false,
			dimensionType: 4,
		}))).toEqual({
			make: 'Cam',
			width: 640,
		});
	});

	test('continues past a non-EXIF APP1 segment', () => {
		expect(parseExif(createExifJpeg({
			littleEndian: true,
			leadingNonExifApp1: true,
		}))).toEqual({
			make: 'Cam',
			width: 640,
		});
	});

	test('rejects an invalid TIFF magic or dimension field contract', () => {
		expect(parseExif(createExifJpeg({
			littleEndian: true,
			tiffMagic: 0,
		}))).toEqual({});
		expect(parseExif(createExifJpeg({
			littleEndian: true,
			dimensionType: 2,
		}))).toEqual({ make: 'Cam' });
	});
});
