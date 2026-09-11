import { describe, expect, test } from 'bun:test';
import { compress, decompress, MAX_TRANSFORM_OUTPUT_BYTES } from '../src/tools/gzip/core';
import { diffLines, getDiffStats } from '../src/tools/diff/core';
import { calculateChecksum, calculateAllChecksums } from '../src/tools/checksum/core';
import { generateFileHash } from '../src/tools/hash/core';
import { md5Bytes, md5Text } from '../src/kernel/utils/md5';
import { splitPDF, extractPages } from '../src/tools/pdf/structure-ops';
import { PDFDocument } from 'pdf-lib';

describe('gzip transform budgets and writer settlement', () => {
	test('round-trips text through compress and decompress', async () => {
		const text = 'HALO gzip round trip: { value: 42, list: [1, 2, 3] }\n'.repeat(50);
		const packed = await compress(text);
		expect(await decompress(packed)).toBe(text);
	});

	test('a decompression result above the budget is rejected, not truncated', async () => {
		const packed = await compress('v'.repeat(4096));
		await expect(decompress(packed, 64)).rejects.toThrow('byte budget');
		await expect(decompress(packed)).resolves.toContain('vvv');
	});

	test('a corrupt gzip payload rejects instead of leaking writer rejections', async () => {
		// Valid base64 of bytes that are not a gzip member.
		const garbage = btoa('definitely not gzip data at all');
		await expect(decompress(garbage)).rejects.toThrow();
	});

	test('the default output budget is exposed and generous', () => {
		expect(MAX_TRANSFORM_OUTPUT_BYTES).toBe(64 * 1024 * 1024);
	});
});

describe('diff bounded memory', () => {
	test('diffs ordinary edits with prefix/suffix stripping', () => {
		const left = 'shared\none\ntwo\nthree\nshared-tail';
		const right = 'shared\none\ntwo (changed)\nthree\nshared-tail';
		const result = diffLines(left, right);
		expect(result.some((entry) => entry.type === 'delete' && entry.value === 'two')).toBe(true);
		expect(result.some((entry) => entry.type === 'insert' && entry.value === 'two (changed)')).toBe(true);
		expect(result[0]).toEqual({ type: 'equal', value: 'shared' });
		expect(result.at(-1)).toEqual({ type: 'equal', value: 'shared-tail' });
		expect(getDiffStats(result)).toEqual({ additions: 1, deletions: 1, changes: 1 });
	});

	test('a middle region past the cell cap degrades to an explicit block replace', () => {
		const left = Array.from({ length: 5000 }, (_, i) => `a${i}`).join('\n');
		const right = Array.from({ length: 5000 }, (_, i) => `b${i}`).join('\n');
		const result = diffLines(left, right);
		const deletes = result.filter((entry) => entry.type === 'delete');
		const inserts = result.filter((entry) => entry.type === 'insert');
		expect(deletes).toHaveLength(5000);
		expect(inserts).toHaveLength(5000);
		// No fabricated equal lines across a fully replaced middle region.
		expect(result.some((entry) => entry.type === 'equal')).toBe(false);
	});

	test('identical texts produce one equal run', () => {
		const text = 'same\nlines\nhere';
		const result = diffLines(text, text);
		expect(result.every((entry) => entry.type === 'equal')).toBe(true);
		expect(result).toHaveLength(3);
	});
});

describe('checksum single-read and shared MD5 owner', () => {
	function countingFile(content: string, name = 'a.txt'): { file: File; reads: () => number } {
		let reads = 0;
		const file = new File([content], name);
		const original = file.arrayBuffer.bind(file);
		Object.defineProperty(file, 'arrayBuffer', {
			value: async () => {
				reads++;
				return original();
			},
		});
		return { file, reads: () => reads };
	}

	test('md5 owner matches RFC 1321 test vectors', () => {
		expect(md5Text('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
		expect(md5Text('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
		expect(md5Text('The quick brown fox jumps over the lazy dog')).toBe('9e107d9d372bb6826bd81d3542a419d6');
		expect(md5Bytes(new TextEncoder().encode('message digest'))).toBe('f96b697d7cb7938d525a2f31aaf161d0');
	});

	test('all checksums are computed with exactly one file read', async () => {
		const { file, reads } = countingFile('checksum body '.repeat(100));
		const results = await calculateAllChecksums(file);
		expect(results.map((entry) => entry.algorithm)).toEqual(['MD5', 'SHA-1', 'SHA-256', 'SHA-512']);
		expect(results.every((entry) => entry.hash.length === 32 || entry.hash.length === 40 || entry.hash.length === 64 || entry.hash.length === 128)).toBe(true);
		expect(reads()).toBe(1);
	});

	test('single algorithm checksum and hash-tool file hash agree with the owner', async () => {
		const { file } = countingFile('shared implementation probe');
		const md5 = (await calculateChecksum(file, 'MD5')).hash;
		expect(md5).toBe(md5Text('shared implementation probe'));
		const hashTool = await generateFileHash(file, 'MD5');
		expect(hashTool).toBe(md5);
	});
});

describe('pdf split and extract strict delivery', () => {
	async function sampleDocument(pages: number): Promise<ArrayBuffer> {
		const doc = await PDFDocument.create();
		for (let index = 0; index < pages; index++) doc.addPage([200, 200]);
		const data = await doc.save();
		return data.buffer.slice(0) as ArrayBuffer;
	}

	test('split delivers one PDF per requested range', async () => {
		const result = await splitPDF({ document: await sampleDocument(6), ranges: [{ start: 0, end: 1 }, { start: 2, end: 3 }, { start: 4, end: 5 }] });
		expect(result.success).toBe(true);
		if (result.success) expect(result.data).toHaveLength(3);
	});

	test('an out-of-bounds range fails explicitly instead of succeeding short', async () => {
		const result = await splitPDF({ document: await sampleDocument(3), ranges: [{ start: 0, end: 1 }, { start: 2, end: 9 }] });
		expect(result.success).toBe(false);
		if (!result.success) expect(result.error).toContain('Invalid page range 3-10');
	});

	test('an empty range list fails explicitly', async () => {
		const result = await splitPDF({ document: await sampleDocument(3), ranges: [] });
		expect(result.success).toBe(false);
	});

	test('extract rejects invalid page numbers instead of dropping them', async () => {
		const result = await extractPages({ document: await sampleDocument(4), pages: [0, 2, 7] });
		expect(result.success).toBe(false);
		if (!result.success) expect(result.error).toContain('8');
	});

	test('extract delivers exactly the requested pages', async () => {
		const result = await extractPages({ document: await sampleDocument(4), pages: [1, 3] });
		expect(result.success).toBe(true);
		if (result.success) expect(result.pageCount).toBe(2);
	});
});
