// goal: PDF Local Core using pdf-lib
// tradeoff: Pure ArrayBuffer ops for memory efficiency

import { PDFDocument, degrees as pdfDegrees, rgb, StandardFonts } from 'pdf-lib';
import type {
	MergeOptions,
	SplitOptions,
	ExtractOptions,
	RotateOptions,
	WatermarkOptions,
	ImagesToPDFOptions,
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

// Rotate pages
export const rotatePages = async (options: RotateOptions): Promise<PDFProcessResult> => {
	try {
		const doc = await PDFDocument.load(options.document);
		const pagesSet = new Set(options.pages);
		const allPages = doc.getPages();

		allPages.forEach((page, index) => {
			if (pagesSet.has(index) || pagesSet.size === 0) {
				const current = page.getRotation().angle;
				page.setRotation(pdfDegrees(current + options.degrees));
			}
		});

		const data = await doc.save();
		return { success: true, data: data.buffer.slice(0) as ArrayBuffer, pageCount: doc.getPageCount() };
	} catch (err) {
		return { success: false, error: (err as Error).message };
	}
};

// Add text watermark
export const addWatermark = async (options: WatermarkOptions): Promise<PDFProcessResult> => {
	try {
		const doc = await PDFDocument.load(options.document);
		const font = await doc.embedFont(StandardFonts.HelveticaBold);
		const text = options.text || 'WATERMARK';
		const opacity = options.opacity ?? 0.3;

		const pages = doc.getPages();
		for (const page of pages) {
			const { width, height } = page.getSize();
			const fontSize = Math.min(width, height) / 8;
			const textWidth = font.widthOfTextAtSize(text, fontSize);

			let x = (width - textWidth) / 2;
			let y = height / 2;

			if (options.position === 'corner') {
				x = 20;
				y = 20;
			}

			page.drawText(text, {
				x,
				y,
				size: fontSize,
				font,
				color: rgb(0.5, 0.5, 0.5),
				opacity,
				rotate: pdfDegrees(45),
			});
		}

		const data = await doc.save();
		return { success: true, data: data.buffer.slice(0) as ArrayBuffer, pageCount: doc.getPageCount() };
	} catch (err) {
		return { success: false, error: (err as Error).message };
	}
};

// Convert images to PDF
export const imagesToPDF = async (options: ImagesToPDFOptions): Promise<PDFProcessResult> => {
	try {
		const doc = await PDFDocument.create();

		for (const imgData of options.images) {
			const bytes = new Uint8Array(imgData);
			// Detect image type from magic bytes
			const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
			const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;

			let image;
			if (isPng) {
				image = await doc.embedPng(imgData);
			} else if (isJpg) {
				image = await doc.embedJpg(imgData);
			} else {
				continue; // Skip unsupported formats
			}

			const { width: imgW, height: imgH } = image;
			// A4 default: 595.28 x 841.89
			let pageW = 595.28;
			let pageH = 841.89;

			if (options.pageSize === 'Letter') {
				pageW = 612;
				pageH = 792;
			} else if (options.pageSize === 'fit') {
				pageW = imgW;
				pageH = imgH;
			}

			const page = doc.addPage([pageW, pageH]);
			const scale = Math.min(pageW / imgW, pageH / imgH, 1);
			const scaledW = imgW * scale;
			const scaledH = imgH * scale;

			page.drawImage(image, {
				x: (pageW - scaledW) / 2,
				y: (pageH - scaledH) / 2,
				width: scaledW,
				height: scaledH,
			});
		}

		const data = await doc.save();
		return { success: true, data: data.buffer.slice(0) as ArrayBuffer, pageCount: doc.getPageCount() };
	} catch (err) {
		return { success: false, error: (err as Error).message };
	}
};

// Get PDF page count without full parsing
export const getPageCount = async (data: ArrayBuffer): Promise<number> => {
	const doc = await PDFDocument.load(data);
	return doc.getPageCount();
};

// Validate PDF structure
export const validatePDF = async (data: ArrayBuffer): Promise<boolean> => {
	try {
		await PDFDocument.load(data);
		return true;
	} catch {
		return false;
	}
};
