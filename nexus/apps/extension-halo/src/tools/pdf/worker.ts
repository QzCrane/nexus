import { PDFDocument } from 'pdf-lib';
import { addWatermark, imagesToPDF, rotatePages } from './content-ops';
import { extractPages, mergePDFs, splitPDF } from './structure-ops';
import { parsePages, parseRanges } from './utils';
import type { PDFProcessResult } from './types';
import {
	PDF_MAX_FILES,
	PDF_MAX_INPUT_BYTES,
	PDF_MAX_IMAGE_PIXELS,
	PDF_MAX_OUTPUT_BYTES,
	PDF_MAX_PAGES,
	type InspectedPDFInput,
	type PDFInputKind,
	type PDFWorkerRequest,
	type PDFWorkerResponse,
} from './worker-contract';

function inputKind(bytes: Uint8Array): PDFInputKind | null {
	if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-') return 'pdf';
	if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
	return null;
}

function assertInputEnvelope(files: readonly File[]): void {
	if (files.length === 0 || files.length > PDF_MAX_FILES) throw new Error(`Select between 1 and ${PDF_MAX_FILES} files.`);
	const bytes = files.reduce((sum, file) => sum + file.size, 0);
	if (bytes > PDF_MAX_INPUT_BYTES) throw new Error('Selected files exceed the 64 MiB input limit.');
}

async function inspect(files: File[]): Promise<InspectedPDFInput[]> {
	assertInputEnvelope(files);
	const inspected: InspectedPDFInput[] = [];
	let pages = 0;
	let imagePixels = 0;
	for (const file of files) {
		const prefix = await file.slice(0, 8).arrayBuffer();
		const kind = inputKind(new Uint8Array(prefix));
		if (!kind) throw new Error(`${file.name}: only valid PDF, PNG and JPEG files are supported.`);
		let pageCount = 1;
		let pixelCount = 0;
		if (kind === 'pdf') {
			const data = await file.arrayBuffer();
			const document = await PDFDocument.load(data);
			pageCount = document.getPageCount();
		} else {
			const bitmap = await createImageBitmap(file);
			try {
				pixelCount = bitmap.width * bitmap.height;
				if (!Number.isSafeInteger(pixelCount) || pixelCount <= 0) throw new Error(`${file.name}: invalid decoded dimensions.`);
			} finally {
				bitmap.close();
			}
		}
		pages += pageCount;
		if (pages > PDF_MAX_PAGES) throw new Error(`Selected files exceed the ${PDF_MAX_PAGES}-page limit.`);
		imagePixels += pixelCount;
		if (imagePixels > PDF_MAX_IMAGE_PIXELS) throw new Error('Selected images exceed the 64 megapixel decoded-pixel limit.');
		inspected.push({
			id: crypto.randomUUID(),
			name: file.name,
			size: file.size,
			createdAt: Date.now(),
			pageCount,
			pixelCount,
			kind,
			file,
		});
	}
	return inspected;
}

function requireKinds(operation: string, inputs: readonly InspectedPDFInput[], allowed: readonly PDFInputKind[]): void {
	const invalid = inputs.find((input) => !allowed.includes(input.kind));
	if (invalid) throw new Error(`${operation} does not support ${invalid.name} (${invalid.kind}).`);
}

function outputData<T>(result: PDFProcessResult<T>): T {
	if (!result.success) throw new Error(result.error);
	return result.data;
}

function assertOutputs(outputs: ArrayBuffer[]): ArrayBuffer[] {
	if (outputs.length === 0) throw new Error('The operation produced no output.');
	const bytes = outputs.reduce((sum, output) => sum + output.byteLength, 0);
	if (bytes > PDF_MAX_OUTPUT_BYTES) throw new Error('PDF output exceeds the 128 MiB result limit.');
	return outputs;
}

async function execute(request: Extract<PDFWorkerRequest, { type: 'execute' }>): Promise<ArrayBuffer[]> {
	const inputs = request.inputs;
	assertInputEnvelope(inputs.map((input) => input.file));
	if (inputs.reduce((sum, input) => sum + input.pageCount, 0) > PDF_MAX_PAGES) {
		throw new Error(`Selected files exceed the ${PDF_MAX_PAGES}-page limit.`);
	}
	if (inputs.reduce((sum, input) => sum + input.pixelCount, 0) > PDF_MAX_IMAGE_PIXELS) {
		throw new Error('Selected images exceed the 64 megapixel decoded-pixel limit.');
	}
	for (const input of inputs) {
		const actualKind = inputKind(new Uint8Array(await input.file.slice(0, 8).arrayBuffer()));
		if (actualKind !== input.kind) throw new Error(`${input.name}: input type changed after inspection.`);
	}
	const data = await Promise.all(inputs.map((input) => input.file.arrayBuffer()));
	const first = data[0];
	if (!first) throw new Error('Select at least one file.');
	switch (request.operation) {
		case 'merge':
			requireKinds('Merge', inputs, ['pdf']);
			return assertOutputs([outputData(await mergePDFs({ documents: data }))]);
		case 'split': {
			requireKinds('Split', inputs, ['pdf']);
			if (inputs.length !== 1) throw new Error('Split requires exactly one PDF.');
			const ranges = parseRanges(request.config.splitRanges);
			if (ranges.length === 0) throw new Error('Invalid page ranges.');
			if (ranges.reduce((sum, range) => sum + range.end - range.start + 1, 0) > PDF_MAX_PAGES) {
				throw new Error(`Page selection exceeds the ${PDF_MAX_PAGES}-page limit.`);
			}
			return assertOutputs(outputData(await splitPDF({ document: first, ranges, maxOutputBytes: PDF_MAX_OUTPUT_BYTES })));
		}
		case 'extract': {
			requireKinds('Extract', inputs, ['pdf']);
			if (inputs.length !== 1) throw new Error('Extract requires exactly one PDF.');
			const pages = parsePages(request.config.extractPages);
			if (pages.length === 0) throw new Error('Invalid page numbers.');
			return assertOutputs([outputData(await extractPages({ document: first, pages }))]);
		}
		case 'rotate':
			requireKinds('Rotate', inputs, ['pdf']);
			if (inputs.length !== 1) throw new Error('Rotate requires exactly one PDF.');
			return assertOutputs([outputData(await rotatePages({ document: first, pages: [], degrees: request.config.rotateDegrees }))]);
		case 'watermark':
			requireKinds('Watermark', inputs, ['pdf']);
			if (inputs.length !== 1) throw new Error('Watermark requires exactly one PDF.');
			return assertOutputs([outputData(await addWatermark({ document: first, text: request.config.watermarkText, opacity: request.config.watermarkOpacity }))]);
		case 'images-to-pdf':
			requireKinds('Images to PDF', inputs, ['png', 'jpeg']);
			return assertOutputs([outputData(await imagesToPDF({ images: data, pageSize: request.config.pageSize }))]);
		default:
			throw new Error(`Unsupported PDF operation: ${request.operation}`);
	}
}

export async function handlePDFWorkerRequest(request: PDFWorkerRequest): Promise<PDFWorkerResponse> {
	try {
		if (request.type === 'inspect') return { ok: true, type: 'inspect', files: await inspect(request.files) };
		return { ok: true, type: 'execute', outputs: await execute(request) };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

const workerScope = globalThis as unknown as {
	addEventListener?: (type: 'message', listener: (event: MessageEvent<PDFWorkerRequest>) => void) => void;
	postMessage?: (message: PDFWorkerResponse, options?: { transfer: Transferable[] }) => void;
};
if (typeof document === 'undefined' && workerScope.addEventListener && workerScope.postMessage) {
	workerScope.addEventListener('message', (event) => {
		void handlePDFWorkerRequest(event.data).then((response) => {
			const transfer = response.ok && response.type === 'execute' ? response.outputs : [];
			workerScope.postMessage?.(response, { transfer });
		});
	});
}
