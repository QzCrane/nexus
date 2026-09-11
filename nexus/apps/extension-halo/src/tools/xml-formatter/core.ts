// goal: preserve complete XML documents through the browser's native DOM owner
// rule: character data is never treated as disposable layout without a schema

import type { XmlResult } from './types';

let parserErrorNamespace: string | undefined;

function indentElements(element: Element, width: number, depth = 0, inheritedSpace = false): void {
	const space = element.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'space');
	const preserve = space === 'preserve' || (space !== 'default' && inheritedSpace);
	const children = Array.from(element.childNodes);
	for (const child of children) {
		if (child.nodeType === Node.ELEMENT_NODE) indentElements(child as Element, width, depth + 1, preserve);
	}
	// Whitespace-only text can separate inline elements. Preserve it along with
	// CDATA and mixed content; only a container without text gains indentation.
	if (preserve || children.length === 0 || children.some((child) => (
		child.nodeType === Node.TEXT_NODE || child.nodeType === Node.CDATA_SECTION_NODE
	))) return;
	const doc = element.ownerDocument;
	for (const child of children) element.insertBefore(doc.createTextNode(`\n${' '.repeat((depth + 1) * width)}`), child);
	element.appendChild(doc.createTextNode(`\n${' '.repeat(depth * width)}`));
}

function serializeXml(input: string, indent: number): XmlResult {
	try {
		const parser = new DOMParser();
		// XML error documents use an engine-owned namespace. Discover it from
		// the current parser so a valid unnamespaced <parsererror> stays data.
		parserErrorNamespace ??= parser.parseFromString('<', 'application/xml')
			.getElementsByTagName('parsererror')[0]?.namespaceURI ?? undefined;
		if (!parserErrorNamespace) throw new Error('XML parser diagnostics are unavailable');
		const doc = parser.parseFromString(input, 'application/xml');
		const error = doc.getElementsByTagNameNS(parserErrorNamespace, 'parsererror')[0];
		if (error) return { formatted: input, valid: false, error: error.textContent?.trim() || 'Parse error', stats: { elements: 0, attributes: 0 } };
		const elements = Array.from(doc.querySelectorAll('*'));
		const stats = { elements: elements.length, attributes: elements.reduce((sum, el) => sum + el.attributes.length, 0) };
		// DOM does not retain an internal DTD subset. Pass these documents through
		// intact instead of introducing a second XML parser or losing declarations.
		if (doc.doctype) return {
			formatted: input, valid: true, stats,
			warning: 'XML with a DTD is kept unchanged to preserve its declarations and entities.',
		};
		if (!Number.isInteger(indent) || indent < 0 || indent > 8) throw new Error('XML indent must be an integer from 0 to 8');
		if (indent > 0) indentElements(doc.documentElement, indent);
		// Declarations are not DOM nodes. Preserve this validated lexical header;
		// node parsing, namespaces and escaping remain native responsibilities.
		const header = /^\uFEFF?(<\?xml\s[\s\S]*?\?>)/u;
		const bom = input.startsWith('\uFEFF') ? '\uFEFF' : '';
		const declaration = input.match(header)?.[1] ?? '';
		const serialized = new XMLSerializer().serializeToString(doc).replace(header, '');
		return { formatted: `${bom}${declaration}${declaration && indent > 0 ? '\n' : ''}${serialized}`, valid: true, stats };
	} catch (error) {
		return { formatted: input, valid: false, error: error instanceof Error ? error.message : 'Unknown error', stats: { elements: 0, attributes: 0 } };
	}
}

export function formatXml(input: string, indent = 2): XmlResult {
	return serializeXml(input, indent);
}

/** Compact native serialization never removes potentially meaningful text. */
export function minifyXml(input: string): XmlResult {
	return serializeXml(input, 0);
}
