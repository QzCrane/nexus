// goal: PDF Local Core using pdf-lib
// trade-off: Imports from sub-modules to reduce file size

import { PDFDocument } from 'pdf-lib';

export * from './structure-ops';
export * from './content-ops';

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
