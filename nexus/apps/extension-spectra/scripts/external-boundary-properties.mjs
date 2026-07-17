import ts from 'typescript';

const EXTERNAL_MEMBER_ROOTS = new Set([
	'chrome',
	'crypto',
	'document',
	'globalThis',
	'localStorage',
	'navigator',
	'performance',
	'sessionStorage',
	'window',
]);

const EXTERNAL_CALL_ROOTS = new Set(['chrome', 'fetch', 'navigator']);
const EXTERNAL_TRANSPORT_METHODS = new Set(['postMessage', 'send', 'sendMessage']);
const EXTERNAL_CONSTRUCTOR_ROOTS = new Set([
	'AudioContext',
	'Blob',
	'Headers',
	'OfflineAudioContext',
	'Peer',
	'Request',
	'Response',
	'URL',
	'webkitAudioContext',
]);

function expressionRootName(node) {
	let current = node;
	while (
		ts.isPropertyAccessExpression(current)
		|| ts.isElementAccessExpression(current)
		|| ts.isCallExpression(current)
	) {
		current = current.expression;
	}
	return ts.isIdentifier(current) ? current.text : null;
}

function propertyNameText(name) {
	if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
		return name.text;
	}
	return null;
}

function collectLiteralProperties(node, names) {
	if (ts.isObjectLiteralExpression(node)) {
		for (const property of node.properties) {
			if (
				ts.isPropertyAssignment(property)
				|| ts.isShorthandPropertyAssignment(property)
				|| ts.isMethodDeclaration(property)
				|| ts.isGetAccessorDeclaration(property)
				|| ts.isSetAccessorDeclaration(property)
			) {
				const name = propertyNameText(property.name);
				if (name) names.add(name);
			}
			if (ts.isPropertyAssignment(property)) {
				collectLiteralProperties(property.initializer, names);
			}
		}
		return;
	}
	if (ts.isArrayLiteralExpression(node)) {
		for (const element of node.elements) collectLiteralProperties(element, names);
	}
}

// Browser and extension APIs validate dictionary/member names at runtime.
// Terser cannot infer those external boundaries, so reserve direct members and
// every nested literal key passed to the known browser/API entry points.
export function collectExternalBoundaryProperties(source, fileName = 'bundle.js') {
	const names = new Set();
	const sourceFile = ts.createSourceFile(
		fileName,
		source,
		ts.ScriptTarget.ESNext,
		true,
		ts.ScriptKind.JS,
	);
	const visit = (node) => {
		if (ts.isPropertyAccessExpression(node)) {
			const root = expressionRootName(node);
			if (root && EXTERNAL_MEMBER_ROOTS.has(root)) names.add(node.name.text);
		}
		if (ts.isCallExpression(node)) {
			const root = expressionRootName(node.expression);
			const transportMethod = ts.isPropertyAccessExpression(node.expression)
				? node.expression.name.text
				: null;
			if (
				(root && EXTERNAL_CALL_ROOTS.has(root))
				|| (transportMethod && EXTERNAL_TRANSPORT_METHODS.has(transportMethod))
			) {
				for (const argument of node.arguments) collectLiteralProperties(argument, names);
			}
		}
		if (ts.isNewExpression(node)) {
			const root = expressionRootName(node.expression);
			if (root && EXTERNAL_CONSTRUCTOR_ROOTS.has(root)) {
				for (const argument of node.arguments ?? []) collectLiteralProperties(argument, names);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return names;
}
