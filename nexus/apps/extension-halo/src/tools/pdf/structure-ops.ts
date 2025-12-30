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
			pages.forEach((page) => merged.addPage(page));
		}
		const data = await merged.save();
		return { success: true, data: data.buffer.slice(0) as ArrayBuffer, pageCount: merged.getPageCount() };
	} catch (err) {
		return { success: false, error: (err as Error).message };
	}
};

// Split PDF by page ranges
export const splitPDF = async (options: SplitOptions): Promise<PDFProcessResult<ArrayBuffer[]>> => {
	try {
		const source = await PDFDocument.load(options.document);
		const results: ArrayBuffer[] = [];

		for (const range of options.ranges) {
			const newDoc = await PDFDocument.create();
			const pageIndices: number[] = [];
			for (let i = range.start; i <= range.end && i < source.getPageCount(); i++) {
				pageIndices.push(i);
			}
			const pages = await newDoc.copyPages(source, pageIndices);
			pages.forEach((page) => newDoc.addPage(page));
			const data = await newDoc.save();
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
		const newDoc = await PDFDocument.create();
		const validPages = options.pages.filter((p) => p >= 0 && p < source.getPageCount());
		const pages = await newDoc.copyPages(source, validPages);
		pages.forEach((page) => newDoc.addPage(page));
		const data = await newDoc.save();
		return { success: true, data: data.buffer.slice(0) as ArrayBuffer, pageCount: newDoc.getPageCount() };
	} catch (err) {
		return { success: false, error: (err as Error).message };
	}
};
