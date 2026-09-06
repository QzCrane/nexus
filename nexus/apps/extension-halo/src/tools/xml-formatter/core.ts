// goal: XML Formatter core logic - format and validate XML (R10)
// rule: parsing and serialization semantics belong to the native DOM engine
// (DOMParser/XMLSerializer). Rebuilt output re-escapes text and attribute
// values through the DOM's own unescaped values, and mixed content keeps its
// inline shape instead of being split or trimmed.

import type { XmlResult } from './types';

function escapeXmlText(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeXmlAttr(value: string): string {
	return escapeXmlText(value)
		.replace(/"/g, '&quot;')
		.replace(/\n/g, '&#10;')
		.replace(/\r/g, '&#13;')
		.replace(/\t/g, '&#9;');
}

function isWhitespaceOnly(node: Node): boolean {
	return node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() === '';
}

function hasSignificantTextChild(node: Element): boolean {
	return Array.from(node.childNodes).some((child) => child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').trim() !== '');
}

function openTag(element: Element): string {
	let tag = `<${element.tagName}`;
	for (const attr of Array.from(element.attributes)) {
		tag += ` ${attr.name}="${escapeXmlAttr(attr.value)}"`;
	}
	return `${tag}>`;
}

function serializeInline(node: Node): string {
	switch (node.nodeType) {
		case Node.TEXT_NODE:
			return escapeXmlText(node.textContent ?? '');
		case Node.CDATA_SECTION_NODE:
			return `<![CDATA[${node.textContent}]]>`;
		case Node.COMMENT_NODE:
			return `<!--${node.textContent}-->`;
		case Node.PROCESSING_INSTRUCTION_NODE:
			return `<?${node.nodeName}${node.textContent ? ` ${node.textContent}` : ''}?>`;
		case Node.ELEMENT_NODE:
			return serializeElement(node as Element, 0, 0);
		default:
			return '';
	}
}

function serializeElement(element: Element, level: number, indent: number): string {
	const pad = indent > 0 ? ' '.repeat(level * indent) : '';
	const childPad = indent > 0 ? ' '.repeat((level + 1) * indent) : '';
	const open = openTag(element);
	const children = Array.from(element.childNodes).filter((child) => !isWhitespaceOnly(child));

	if (children.length === 0) return `${pad}${open}</${element.tagName}>`;

	// Mixed content keeps its inline order; trimming or re-flowing it would
	// change the document's text.
	if (hasSignificantTextChild(element)) {
		return `${pad}${open}${children.map(serializeInline).join('')}</${element.tagName}>`;
	}

	const rendered = children.map((child) => (child.nodeType === Node.ELEMENT_NODE
		? serializeElement(child as Element, level + 1, indent)
		: `${childPad}${serializeInline(child)}`));
	const joiner = indent > 0 ? `\n` : '';
	const body = indent > 0
		? `\n${rendered.join(joiner)}\n${pad}`
		: rendered.join('');
	return `${pad}${open}${body}</${element.tagName}>`;
}

function parseXml(input: string): { doc: Document; error?: string } {
	const parser = new DOMParser();
	const doc = parser.parseFromString(input, 'application/xml');
	const error = doc.querySelector('parsererror');
	if (error) {
		return { doc, error: error.textContent?.trim() || 'Parse error' };
	}
	return { doc };
}

// Format XML with indentation
export function formatXml(input: string, indent = 2): XmlResult {
	try {
		const { doc, error } = parseXml(input);
		if (error) {
			return { formatted: input, valid: false, error, stats: { elements: 0, attributes: 0 } };
		}

		const elements = doc.querySelectorAll('*').length;
		let attributes = 0;
		doc.querySelectorAll('*').forEach((el) => { attributes += el.attributes.length; });

		const formatted = serializeElement(doc.documentElement, 0, indent);

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

/**
 * Minify XML by removing whitespace-only text nodes through the DOM and
 * serializing: character data and meaningful inter-word whitespace survive.
 */
export function minifyXml(input: string): XmlResult {
	try {
		const { doc, error } = parseXml(input);
		if (error) {
			return { formatted: input, valid: false, error, stats: { elements: 0, attributes: 0 } };
		}

		const walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_TEXT);
		const removable: Text[] = [];
		while (walker.nextNode()) {
			const text = walker.currentNode as Text;
			if ((text.textContent ?? '').trim() === '') removable.push(text);
		}
		for (const node of removable) node.remove();

		const serializer = new XMLSerializer();
		return {
			formatted: serializer.serializeToString(doc),
			valid: true,
			stats: {
				elements: doc.querySelectorAll('*').length,
				attributes: Array.from(doc.querySelectorAll('*')).reduce((sum, el) => sum + el.attributes.length, 0),
			},
		};
	} catch (e) {
		return {
			formatted: input,
			valid: false,
			error: e instanceof Error ? e.message : 'Unknown error',
			stats: { elements: 0, attributes: 0 },
		};
	}
}
