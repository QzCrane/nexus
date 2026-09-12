import { describe, expect, test } from 'bun:test';
import { PDFDocument } from 'pdf-lib';
import { handlePDFWorkerRequest } from '../src/tools/pdf/worker';
import { DEFAULT_CONFIG } from '../src/tools/pdf/config-panel';
import { splitPDF } from '../src/tools/pdf/structure-ops';
import { executeRegex, replaceMatches, REGEX_MAX_TEXT_UNITS } from '../src/tools/regex/core';
import { handleRegexWorkerRequest } from '../src/tools/regex/worker';
import { DEFAULT_FLAGS } from '../src/tools/regex/types';
import { IMAGE_MAX_DECODED_PIXELS, IMAGE_MAX_INPUT_BYTES } from '../src/tools/image-tools/worker-contract';
import { handleImageWorkerRequest } from '../src/tools/image-tools/worker';
import { imageToBase64 } from '../src/tools/image-tools/core';
import { OwnedAsyncTask } from '../src/kernel/utils/owned-async-task';

async function pdfFile(name: string, pages: number): Promise<File> {
	const document = await PDFDocument.create();
	for (let page = 0; page < pages; page += 1) document.addPage([200, 200]);
	return new File([await document.save()], name, { type: 'application/pdf' });
}

describe('PDF worker boundary', () => {
	test('inspects a PDF once and preserves every requested split range', async () => {
		const inspected = await handlePDFWorkerRequest({ type: 'inspect', files: [await pdfFile('six.pdf', 6)] });
		expect(inspected.ok).toBe(true);
		if (!inspected.ok || inspected.type !== 'inspect') return;
		expect(inspected.files[0]?.pageCount).toBe(6);
		const result = await handlePDFWorkerRequest({
			type: 'execute',
			operation: 'split',
			inputs: inspected.files,
			config: { ...DEFAULT_CONFIG, splitRanges: '1-2,3-4,5-6' },
		});
		expect(result.ok).toBe(true);
		if (result.ok && result.type === 'execute') expect(result.outputs).toHaveLength(3);
	});

	test('rejects mixed operation inputs instead of silently dropping them', async () => {
		const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'image.png', { type: 'image/png' });
		const pdf = await pdfFile('one.pdf', 1);
		const result = await handlePDFWorkerRequest({ type: 'execute', operation: 'merge', inputs: [
			{ id: 'pdf', name: pdf.name, size: pdf.size, createdAt: 1, pageCount: 1, pixelCount: 0, kind: 'pdf', file: pdf },
			{ id: 'png', name: png.name, size: png.size, createdAt: 1, pageCount: 1, pixelCount: 1, kind: 'png', file: png },
		], config: DEFAULT_CONFIG });
		expect(result).toMatchObject({ ok: false });
		if (!result.ok) expect(result.error).toContain('does not support image.png');
	});

	test('rejects spoofed and unsupported input using bytes rather than extension', async () => {
		const result = await handlePDFWorkerRequest({
			type: 'inspect',
			files: [new File(['not a document'], 'spoof.pdf', { type: 'application/pdf' })],
		});
		expect(result).toMatchObject({ ok: false });
	});

	test('stops split output accumulation at the configured byte budget', async () => {
		const file = await pdfFile('two.pdf', 2);
		const result = await splitPDF({
			document: await file.arrayBuffer(),
			ranges: [{ start: 0, end: 0 }, { start: 1, end: 1 }],
			maxOutputBytes: 1,
		});
		expect(result).toMatchObject({ success: false });
		if (!result.success) expect(result.error).toContain('result limit');
	});
});

describe('regex worker boundary', () => {
	test('uses code-point-safe empty-match advancement and stable line positions', () => {
		const matches = executeRegex('(?:)', '😀\nX', { ...DEFAULT_FLAGS, unicode: true });
		expect(matches.slice(0, 3).map(({ index, line, column }) => ({ index, line, column }))).toEqual([
			{ index: 0, line: 1, column: 1 },
			{ index: 2, line: 1, column: 3 },
			{ index: 3, line: 2, column: 1 },
		]);
	});

	test('distinguishes invalid input from an empty match result', () => {
		const result = handleRegexWorkerRequest({ pattern: '[', testString: 'abc', replacement: '', flags: DEFAULT_FLAGS, includeReplacement: false });
		expect(result.ok).toBe(false);
	});

	test('bounds input and replacement output', () => {
		expect(() => executeRegex('a', 'x'.repeat(REGEX_MAX_TEXT_UNITS + 1), DEFAULT_FLAGS)).toThrow('limit');
		expect(() => replaceMatches('a', 'a'.repeat(5_000), 'x'.repeat(1_000), DEFAULT_FLAGS)).toThrow('4 MiB');
		expect(() => executeRegex('a', 'a'.repeat(10_000), DEFAULT_FLAGS)).toThrow('10000');
	});
});

describe('image worker boundary', () => {
	test('rejects oversized input before decoding', async () => {
		const result = await handleImageWorkerRequest({
			type: 'inspect',
			file: new File([new Uint8Array(IMAGE_MAX_INPUT_BYTES + 1)], 'oversized.png'),
		});
		expect(result).toMatchObject({ ok: false });
		if (!result.ok) expect(result.error).toContain('32 MiB');
	});

	test('closes the decoded bitmap after a bounded inspection', async () => {
		const globals = globalThis as unknown as { createImageBitmap: typeof createImageBitmap };
		const original = globals.createImageBitmap;
		let closes = 0;
		globals.createImageBitmap = async () => ({
			width: 640,
			height: 480,
			close: () => { closes += 1; },
		} as ImageBitmap);
		try {
			const result = await handleImageWorkerRequest({ type: 'inspect', file: new File(['image'], 'image.png', { type: 'image/png' }) });
			expect(result).toMatchObject({ ok: true, type: 'inspect', info: { width: 640, height: 480 } });
			expect(closes).toBe(1);
		} finally {
			globals.createImageBitmap = original;
		}
	});

	test('exposes the intended single-job memory envelope', () => {
		expect(IMAGE_MAX_INPUT_BYTES).toBe(32 * 1024 * 1024);
		expect(IMAGE_MAX_DECODED_PIXELS).toBe(32 * 1024 * 1024);
	});

	test('physically aborts a Base64 FileReader when its owner is cancelled', async () => {
		const original = globalThis.FileReader;
		let aborts = 0;
		class PendingFileReader {
			static readonly LOADING = 1;
			readyState = PendingFileReader.LOADING;
			result: string | ArrayBuffer | null = null;
			error: DOMException | null = null;
			onload: FileReader['onload'] = null;
			onerror: FileReader['onerror'] = null;
			onabort: FileReader['onabort'] = null;
			readAsDataURL(): void {}
			abort(): void {
				aborts += 1;
				this.readyState = 2;
				this.onabort?.({} as ProgressEvent<FileReader>);
			}
		}
		Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: PendingFileReader });
		try {
			const task = new OwnedAsyncTask();
			const running = task.run(() => imageToBase64(new Blob(['image'])));
			task.cancel();
			expect(await running).toEqual({ kind: 'cancelled', reason: 'cancelled' });
			expect(aborts).toBe(1);
		} finally {
			Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: original });
		}
	});
});
