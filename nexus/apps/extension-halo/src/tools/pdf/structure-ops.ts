// goal: PDF Structure Operations (Merge, Split, Extract)
// eff: Extracted from core.ts

import { PDFDocument } from 'pdf-lib';
import type {
	MergeOptions,
	SplitOptions,
	ExtractOptions,
	PDFProcessResult,
} from './types';

// Merge multiple PDFs into one
export const mergePDFs = async (options: MergeOptions): Promise<PDFProcessResult> => {
	try {
		const merged = await PDFDocument.create();
		for (const docData of options.documents) {
			const doc = await PDFDocument.load(docData);
			const pages = await merged.copyPages(doc, doc.getPageIndices());
			pages.forEach((page) => {
				merged.addPage(page);
			});
		}
		const data = await merged.save();
		return { success: true, data: data.buffer.slice(0) as ArrayBuffer, pageCount: merged.getPageCount() };
	} catch (err) {
		return { success: false, error: (err as Error).message };
	}
};

// Split PDF by page ranges (0-based, inclusive)
export const splitPDF = async (options: SplitOptions): Promise<PDFProcessResult<ArrayBuffer[]>> => {
	try {
		const source = await PDFDocument.load(options.document);
		const pageCount = source.getPageCount();
		if (options.ranges.length === 0) {
			return { success: false, error: 'No page ranges were provided.' };
		}
		// rule: an out-of-bounds range must fail explicitly — clamping would
		// turn a bad request into a success that quietly misses content.
		for (const range of options.ranges) {
			const valid = Number.isInteger(range.start)
				&& Number.isInteger(range.end)
				&& range.start >= 0
				&& range.end >= range.start
				&& range.end < pageCount;
			if (!valid) {
				return { success: false, error: `Invalid page range ${range.start + 1}-${range.end + 1}: the document has ${pageCount} pages.` };
			}
		}
		const results: ArrayBuffer[] = [];
		let outputBytes = 0;

		for (const range of options.ranges) {
			const newDoc = await PDFDocument.create();
			const pageIndices: number[] = [];
			for (let i = range.start; i <= range.end; i++) {
				pageIndices.push(i);
			}
			const pages = await newDoc.copyPages(source, pageIndices);
			pages.forEach((page) => {
				newDoc.addPage(page);
			});
			const data = await newDoc.save();
			outputBytes += data.byteLength;
			if (options.maxOutputBytes !== undefined && outputBytes > options.maxOutputBytes) {
				return { success: false, error: `Split output exceeds the ${Math.floor(options.maxOutputBytes / (1024 * 1024))} MiB result limit.` };
			}
			results.push(data.buffer.slice(0) as ArrayBuffer);
		}
		return { success: true, data: results };
	} catch (err) {
		return { success: false, error: (err as Error).message };
	}
};

// Extract specific pages
export const extractPages = async (options: ExtractOptions): Promise<PDFProcessResult> => {
	try {
		const source = await PDFDocument.load(options.document);
		const pageCount = source.getPageCount();
		const invalid = options.pages.filter((p) => !Number.isInteger(p) || p < 0 || p >= pageCount);
		if (invalid.length > 0) {
			// 0-based input coming from parsePages is 1-based to the user.
			const listed = invalid.map((p) => p + 1).join(', ');
			return { success: false, error: `Invalid page numbers: ${listed}; the document has ${pageCount} pages.` };
		}
		const newDoc = await PDFDocument.create();
		const pages = await newDoc.copyPages(source, options.pages);
		pages.forEach((page) => {
			newDoc.addPage(page);
		});
		const data = await newDoc.save();
		return { success: true, data: data.buffer.slice(0) as ArrayBuffer, pageCount: newDoc.getPageCount() };
	} catch (err) {
		return { success: false, error: (err as Error).message };
	}
};
