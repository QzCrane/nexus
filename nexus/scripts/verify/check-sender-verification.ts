// goal: a message that cannot prove who sent it must not be acted upon (INV-11)
//
// SP-34 fixed eighteen sender checks and this gate is why that number stayed
// eighteen for exactly one round. Two more were found afterwards, both invisible
// to a text sweep for `sender.id &&`:
//
//   - content/input/hotkey-listener.ts rewrote the live hotkey bindings from a
//     `spectra.hotkeys.changed` event and never looked at the sender at all;
//   - content/core/lifecycle/popup-connection.ts trusted a port *name*, which is
//     a public string, to set `isPopupOpen`.
//
// Both classes are machine-checkable. This gate therefore enforces two rules:
//
//   1. no fail-open form of the comparison anywhere in shipped code;
//   2. every file that registers a message or port listener inside the two
//      authority contexts (Background, Content) must perform a strict comparison
//      in that same file, or be recorded here as delegating it.

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript-compiler-api';
import { loadSpectraVerificationProgram } from './source-evidence.ts';
import { error, ok, section, warn } from './utils.ts';

/**
 * Background is the authority and Content runs inside a page the extension does
 * not control. Popup, Options and Offscreen are extension-origin pages, so they
 * are not part of the attack surface this gate describes.
 */
const ENTRY_ROOTS = [
	'apps/extension-spectra/src/background',
	'apps/extension-spectra/src/content',
] as const;

/** Every shipped tree, for the fail-open rule, which admits no exceptions. */
const ALL_ROOTS = [
	...ENTRY_ROOTS,
	'apps/extension-spectra/src/offscreen',
	'apps/extension-spectra/src/popup',
	'apps/extension-spectra/src/remote',
	'apps/extension-spectra/src/shared',
	'packages/contracts/src',
] as const;

const BASELINE_PATH = path.join('scripts', 'verify', 'sender-verification-baseline.json');

const LISTENER = /\b(?:onMessage|onMessageExternal|onConnect)\.addListener\b/u;
const STRICT = /_?sender\??\.id\s*(?:!==|===)/u;
const FAIL_OPEN = /_?sender\??\.id\s*(?:&&|\?)/u;

interface BaselineEntry {
	readonly owner: string;
	readonly reason: string;
}

interface Baseline {
	readonly delegates: Record<string, BaselineEntry>;
}

function listSources(root: string, target: string): string[] {
	const absolute = path.join(root, target);
	if (!fs.existsSync(absolute)) return [];
	if (fs.statSync(absolute).isFile()) return [absolute];
	const found: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === 'node_modules' || entry.name === 'dist') continue;
				walk(full);
				continue;
			}
			if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) continue;
			found.push(full);
		}
	};
	walk(absolute);
	return found;
}

function normalize(file: string): string {
	return file.split(path.sep).join('/');
}

/**
 * A hit inside a comment is not code. The first false positive this rule
 * produced was the comment explaining the rule.
 */
function codeLines(text: string): string[] {
	return text.split('\n').filter((line) => {
		const trimmed = line.trim();
		return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
	});
}

function readBaseline(root: string): Baseline {
	const file = path.join(root, BASELINE_PATH);
	if (!fs.existsSync(file)) return { delegates: {} };
	const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
	const delegates = (parsed as Baseline).delegates ?? {};
	return { delegates };
}

/** A canonical imported guard must reject this exact port before registration. */
export function hasCanonicalPortSenderAdmission(
	source: ts.SourceFile,
	checker: ts.TypeChecker,
	canonicalOwner: string,
): boolean {
	let listeners = 0;
	let unguarded = false;
	const symbolOf = (node: ts.Node): ts.Symbol | undefined => {
		const symbol = checker.getSymbolAtLocation(node);
		return symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
	};
	const canonicalFunction = (node: ts.Node, name: string): ts.FunctionDeclaration | null => {
		const declaration = symbolOf(node)?.valueDeclaration;
		return declaration && ts.isFunctionDeclaration(declaration) && declaration.name?.text === name
			&& normalize(path.resolve(declaration.getSourceFile().fileName)) === normalize(path.resolve(canonicalOwner))
			? declaration : null;
	};
	const baseRejectsInvalidSender = (base: ts.FunctionDeclaration): boolean => {
		const sender = base.parameters[0]?.name;
		if (!sender || !base.body) return false;
		let unsafeReturn = false;
		const inspectReturns = (node: ts.Node): void => {
			if (ts.isReturnStatement(node) && node.expression?.kind === ts.SyntaxKind.TrueKeyword) unsafeReturn = true;
			ts.forEachChild(node, inspectReturns);
		};
		inspectReturns(base.body);
		const rejection = base.body.statements.some((statement) => {
			if (!ts.isIfStatement(statement) || !ts.isReturnStatement(statement.thenStatement)
				|| statement.thenStatement.expression?.kind !== ts.SyntaxKind.FalseKeyword) return false;
			let strict = false;
			const inspect = (node: ts.Node): void => {
				if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
					inspect(node.left); inspect(node.right); return;
				}
				if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsEqualsToken
					|| !ts.isPropertyAccessExpression(node.left) || node.left.name.text !== 'id'
					|| symbolOf(node.left.expression) !== symbolOf(sender)) return;
				const id = symbolOf(node.right)?.valueDeclaration;
				strict = !!id && ts.isVariableDeclaration(id) && !!id.initializer && ts.isCallExpression(id.initializer)
					&& !!canonicalFunction(id.initializer.expression, 'ownExtensionId');
			};
			inspect(statement.expression);
			return strict;
		});
		const returned = base.body.statements[base.body.statements.length - 1];
		if (unsafeReturn || !rejection || !returned || !ts.isReturnStatement(returned) || !returned.expression) return false;
		const comparisons = new Map<string, ts.Expression>();
		const inspectConjunction = (node: ts.Expression): void => {
			if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
				inspectConjunction(node.left); inspectConjunction(node.right); return;
			}
			if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
				&& ts.isPropertyAccessExpression(node.left)) comparisons.set(node.left.name.text, node.right);
		};
		inspectConjunction(returned.expression);
		const protocol = comparisons.get('protocol');
		const host = comparisons.get('host');
		const pathname = comparisons.get('pathname');
		const hostDeclaration = host && symbolOf(host)?.valueDeclaration;
		return !!protocol && ts.isStringLiteral(protocol) && protocol.text === 'chrome-extension:'
			&& !!hostDeclaration && ts.isVariableDeclaration(hostDeclaration) && !!hostDeclaration.initializer
			&& ts.isCallExpression(hostDeclaration.initializer) && !!canonicalFunction(hostDeclaration.initializer.expression, 'ownExtensionId')
			&& !!pathname && ts.isTemplateExpression(pathname) && pathname.head.text === '/'
			&& pathname.templateSpans.length === 1 && pathname.templateSpans[0]?.literal.text === ''
			&& symbolOf(pathname.templateSpans[0].expression) === symbolOf(base.parameters[1]?.name ?? base);
	};
	const forwardsSender = (declaration: ts.FunctionDeclaration): boolean => {
		const statements = declaration.body?.statements;
		const returned = statements?.[0];
		const parameter = declaration.parameters[0];
		if (statements?.length !== 1 || !returned || !ts.isReturnStatement(returned)
			|| !returned.expression || !parameter || !ts.isIdentifier(parameter.name)) return false;
		const isSender = (node: ts.Node | undefined): boolean => !!node && symbolOf(node) === symbolOf(parameter.name);
		if (declaration.name?.text === 'isPopupDocumentSender') {
			const call = returned.expression;
			if (!ts.isCallExpression(call)) return false;
			const base = canonicalFunction(call.expression, 'isExtensionDocumentSender');
			const popupPath = call.arguments[1] && symbolOf(call.arguments[1])?.valueDeclaration;
			return !!base && baseRejectsInvalidSender(base) && isSender(call.arguments[0]) && call.arguments.length === 2
				&& !!popupPath && ts.isVariableDeclaration(popupPath) && popupPath.name.getText() === 'ACTION_POPUP_PATH'
				&& normalize(path.resolve(popupPath.getSourceFile().fileName))
					=== normalize(path.resolve(path.dirname(canonicalOwner), '../shared/popup-bootstrap.ts'));
		}
		const conjunction = returned.expression;
		if (!ts.isBinaryExpression(conjunction) || conjunction.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken
			|| !ts.isBinaryExpression(conjunction.left) || conjunction.left.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken
			|| !ts.isPropertyAccessExpression(conjunction.left.left) || conjunction.left.left.name.text !== 'tab'
			|| !isSender(conjunction.left.left.expression) || !ts.isIdentifier(conjunction.left.right)
			|| conjunction.left.right.text !== 'undefined' || !ts.isCallExpression(conjunction.right)) return false;
		const delegate = canonicalFunction(conjunction.right.expression, 'isPopupDocumentSender');
		return !!delegate && conjunction.right.arguments.length === 1 && isSender(conjunction.right.arguments[0]) && forwardsSender(delegate);
	};
	const approvedGuard = (call: ts.CallExpression, port: ts.Identifier): boolean => {
		const declaration = symbolOf(call.expression)?.valueDeclaration;
		if (!declaration || normalize(path.resolve(declaration.getSourceFile().fileName)) !== normalize(path.resolve(canonicalOwner))
			|| !ts.isFunctionDeclaration(declaration)
			|| !['isActionPopupSender', 'isPopupDocumentSender'].includes(declaration.name?.text ?? '')
			|| !forwardsSender(declaration)) return false;
		const sender = call.arguments[0];
		return call.arguments.length === 1 && !!sender && ts.isPropertyAccessExpression(sender)
			&& sender.name.text === 'sender' && symbolOf(sender.expression) === symbolOf(port);
	};
	const reassignsPort = (statement: ts.Statement, port: ts.Identifier): boolean => {
		let assigned = false;
		const visit = (node: ts.Node): void => {
			if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
				&& node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && ts.isIdentifier(node.left)
				&& symbolOf(node.left) === symbolOf(port)) assigned = true;
			ts.forEachChild(node, visit);
		};
		visit(statement);
		return assigned;
	};
	const rejectsPort = (statement: ts.Statement, port: ts.Identifier): boolean => {
		if (!ts.isIfStatement(statement) || !ts.isPrefixUnaryExpression(statement.expression)
			|| statement.expression.operator !== ts.SyntaxKind.ExclamationToken
			|| !ts.isCallExpression(statement.expression.operand)
			|| !approvedGuard(statement.expression.operand, port)
			|| !ts.isBlock(statement.thenStatement)) return false;
		const statements = statement.thenStatement.statements;
		const disconnect = statements[0];
		const exit = statements[1];
		return statements.length === 2 && !!disconnect && ts.isExpressionStatement(disconnect)
			&& ts.isCallExpression(disconnect.expression) && disconnect.expression.arguments.length === 0
			&& ts.isPropertyAccessExpression(disconnect.expression.expression)
			&& disconnect.expression.expression.name.text === 'disconnect'
			&& symbolOf(disconnect.expression.expression.expression) === symbolOf(port)
			&& !!exit && ts.isReturnStatement(exit) && !exit.expression;
	};
	const visit = (node: ts.Node): void => {
		if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
			&& node.expression.name.text === 'addListener' && ts.isPropertyAccessExpression(node.expression.expression)
			&& ['onMessage', 'onMessageExternal', 'onConnect'].includes(node.expression.expression.name.text)) {
			listeners++;
			const port = node.expression.expression.expression;
			const statement = node.parent;
			const body = statement.parent;
			if (!ts.isIdentifier(port) || !ts.isExpressionStatement(statement) || !ts.isBlock(body)
				|| !ts.isFunctionLike(body.parent) || body.parent.body !== body
				|| !body.statements.slice(0, body.statements.indexOf(statement)).some((entry, index, earlier) =>
					rejectsPort(entry, port) && !earlier.slice(index + 1).some((later) => reassignsPort(later, port)))) {
				unguarded = true;
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return listeners > 0 && !unguarded;
}

export function checkSenderVerification(ROOT: string): void {
	section('检查发送方校验（G6 / INV-11）...');

	const baseline = readBaseline(ROOT);
	let program: ts.Program | undefined;
	let failOpenCount = 0;

	for (const relative of ALL_ROOTS) {
		for (const file of listSources(ROOT, relative)) {
			const rel = normalize(path.relative(ROOT, file));
			codeLines(fs.readFileSync(file, 'utf8')).forEach((line) => {
				if (!FAIL_OPEN.test(line)) return;
				failOpenCount += 1;
				error(`SENDER-001: fail-open sender check in ${rel}: ${line.trim()}`);
			});
		}
	}

	const seen = new Set<string>();
	for (const relative of ENTRY_ROOTS) {
		for (const file of listSources(ROOT, relative)) {
			const rel = normalize(path.relative(ROOT, file));
			const text = fs.readFileSync(file, 'utf8');
			if (!LISTENER.test(text)) continue;
			seen.add(rel);
			if (STRICT.test(text)) continue;
			program ??= loadSpectraVerificationProgram(ROOT);
			const source = program.getSourceFile(file);
			if (source && hasCanonicalPortSenderAdmission(source, program.getTypeChecker(),
				path.join(ROOT, 'apps/extension-spectra/src/background/popup-document-sender.ts'))) continue;
			const delegate = baseline.delegates[rel];
			if (!delegate) {
				error(`SENDER-002: ${rel} registers a listener without a strict sender check`);
				continue;
			}
			if (!delegate.owner.trim() || !delegate.reason.trim()) {
				error(`SENDER-002: ${rel} is recorded as delegating without naming its owner and reason`);
			}
		}
	}

	for (const [rel] of Object.entries(baseline.delegates)) {
		if (seen.has(rel)) continue;
		warn(`SENDER-003: baseline names ${rel}, which no longer registers a listener`, true);
	}

	if (failOpenCount === 0) ok('no fail-open sender comparison in any shipped tree');
	ok(`sender verification checked across ${seen.size} listener hosts`);
}
