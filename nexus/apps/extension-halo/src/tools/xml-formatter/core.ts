// goal: XML Formatter core logic - format and validate XML

import type { XmlResult } from './types';

// Format XML with indentation
export function formatXml(input: string, indent = 2): XmlResult {
	try {
		// Parse to validate
		const parser = new DOMParser();
		const doc = parser.parseFromString(input, 'application/xml');
		const error = doc.querySelector('parsererror');

		if (error) {
			return {
				formatted: input,
				valid: false,
				error: error.textContent || 'Parse error',
				stats: { elements: 0, attributes: 0 },
			};
		}

		// Count elements and attributes
		const elements = doc.querySelectorAll('*').length;
		let attributes = 0;
		doc.querySelectorAll('*').forEach((el) => { attributes += el.attributes.length; });

		// Format with indentation
		const formatted = formatNode(doc.documentElement, 0, indent);

		return { formatted, valid: true, stats: { elements, attributes } };
	} catch (e) {
		return {
			formatted: input,
			valid: false,
			error: e instanceof Error ? e.message : 'Unknown error',
			stats: { elements: 0, attributes: 0 },
		};
	}
}

// Recursive node formatting
function formatNode(node: Element, level: number, indent: number): string {
	const pad = ' '.repeat(level * indent);
	const childPad = ' '.repeat((level + 1) * indent);

	// Build opening tag with attributes
	let result = `${pad}<${node.tagName}`;
	for (const attr of Array.from(node.attributes)) {
		result += ` ${attr.name}="${attr.value}"`;
	}

	// Self-closing if no children
	if (!node.childNodes.length) {
		return `${result}/>`;
	}

	result += '>';

	// Check if only text content
	const onlyChild = node.firstChild;
	const hasOnlyText = node.childNodes.length === 1 && onlyChild?.nodeType === Node.TEXT_NODE;
	if (hasOnlyText) {
		const text = node.textContent?.trim() || '';
		return `${result + text}</${node.tagName}>`;
	}

	// Process children
	result += '\n';
	for (const child of Array.from(node.childNodes)) {
		if (child.nodeType === Node.ELEMENT_NODE) {
			result += `${formatNode(child as Element, level + 1, indent)}\n`;
		} else if (child.nodeType === Node.TEXT_NODE) {
			const text = child.textContent?.trim();
			if (text) result += `${childPad + text}\n`;
		} else if (child.nodeType === Node.COMMENT_NODE) {
			result += `${childPad}<!--${child.textContent}-->\n`;
		}
	}

	result += `${pad}</${node.tagName}>`;
	return result;
}

// Minify XML
export function minifyXml(input: string): XmlResult {
	const result = formatXml(input);
	if (!result.valid) return result;

	const minified = result.formatted.replace(/>\s+</g, '><').replace(/\n/g, '').trim();
	return { ...result, formatted: minified };
}
