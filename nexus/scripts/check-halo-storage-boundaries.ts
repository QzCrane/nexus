// goal: Compiler-owned admission for HALO useToolState persistence contracts

import { resolve } from 'node:path';
import ts from 'typescript-compiler-api';

export interface HaloStorageBoundaryDiagnostic {
	readonly file: string;
	readonly line: number;
	readonly stateType: string;
	readonly reason: 'missing-domain-codec' | 'incompatible-domain-codec';
}

export interface HaloStorageBoundaryAudit {
	readonly corpus: 'tsconfig-src';
	readonly sourceFiles: number;
	readonly total: number;
	readonly simple: number;
	readonly codec: number;
	readonly normalize: number;
	readonly diagnostics: readonly HaloStorageBoundaryDiagnostic[];
}

function normalizedPath(path: string): string {
	return path.replaceAll('\\', '/');
}

function canonicalUseToolStateSignature(
	checker: ts.TypeChecker,
	node: ts.CallExpression,
	canonicalDeclarationSuffix: string,
): ts.Signature | null {
	const signature = checker.getResolvedSignature(node);
	const declaration = signature?.getDeclaration();
	if (!signature || !declaration) return null;
	if (!normalizedPath(declaration.getSourceFile().fileName).endsWith(canonicalDeclarationSuffix)) return null;
	if (!ts.isFunctionDeclaration(declaration) || declaration.name?.text !== 'useToolState') return null;
	return signature;
}

function simpleUnboundedPrimitive(type: ts.Type): boolean {
	return (type.flags & ts.TypeFlags.String) !== 0 || (type.flags & ts.TypeFlags.Boolean) !== 0;
}

function requiredPropertyType(
	checker: ts.TypeChecker,
	type: ts.Type,
	name: string,
	location: ts.Node,
): ts.Type | null {
	const property = checker.getPropertyOfType(type, name);
	if (!property || (property.flags & ts.SymbolFlags.Optional) !== 0) return null;
	return checker.getTypeOfSymbolAtLocation(property, location);
}

function expectedOptionPropertyType(
	checker: ts.TypeChecker,
	signature: ts.Signature,
	name: string,
	location: ts.Node,
): ts.Type | null {
	const optionsParameter = signature.getParameters()[2];
	if (!optionsParameter) return null;
	const optionsType = checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(optionsParameter, location));
	const property = checker.getPropertyOfType(optionsType, name);
	if (!property) return null;
	return checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(property, location));
}

function containsUnsafeTopLevelTypeArgument(checker: ts.TypeChecker, type: ts.Type): boolean {
	if ((type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) return true;
	if (type.isUnionOrIntersection() && type.types.some((entry) => containsUnsafeTopLevelTypeArgument(checker, entry))) return true;
	if ((type.flags & ts.TypeFlags.Object) === 0) return false;
	const objectType = type as ts.ObjectType;
	if ((objectType.objectFlags & ts.ObjectFlags.Reference) === 0) return false;
	return checker.getTypeArguments(type as ts.TypeReference)
		.some((argument) => (argument.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0);
}

export function auditHaloStorageBoundaries(
	program: ts.Program,
	sourceRoot: string,
	canonicalDeclarationSuffix = '/kernel/hooks/use-tool-state.ts',
): HaloStorageBoundaryAudit {
	const checker = program.getTypeChecker();
	const normalizedRoot = normalizedPath(resolve(sourceRoot));
	const diagnostics: HaloStorageBoundaryDiagnostic[] = [];
	let total = 0;
	let simple = 0;
	let codec = 0;
	let normalize = 0;
	let sourceFiles = 0;

	for (const sourceFile of program.getSourceFiles()) {
		const file = normalizedPath(sourceFile.fileName);
		if (!file.startsWith(`${normalizedRoot}/`) || file.endsWith(canonicalDeclarationSuffix)) continue;
		sourceFiles++;
		const visit = (node: ts.Node): void => {
			if (ts.isCallExpression(node)) {
				const signature = canonicalUseToolStateSignature(checker, node, canonicalDeclarationSuffix);
				if (!signature) {
					ts.forEachChild(node, visit);
					return;
				}
				total++;
				const initialValue = node.arguments[1];
				const stateType = node.typeArguments?.[0]
					? checker.getTypeFromTypeNode(node.typeArguments[0])
					: initialValue ? checker.getTypeAtLocation(initialValue) : checker.getAnyType();
				const options = node.arguments[2];
				const optionsType = options ? checker.getTypeAtLocation(options) : null;
				const codecType = optionsType && options ? requiredPropertyType(checker, optionsType, 'codec', options) : null;
				const normalizeType = optionsType && options ? requiredPropertyType(checker, optionsType, 'normalize', options) : null;
				const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
				const diagnosticBase = {
					file: file.slice(normalizedRoot.length + 1),
					line: position.line + 1,
					stateType: checker.typeToString(stateType),
				};

				if (codecType) {
					codec++;
					const expected = expectedOptionPropertyType(checker, signature, 'codec', options ?? node);
					if (!expected || containsUnsafeTopLevelTypeArgument(checker, codecType)
						|| !checker.isTypeAssignableTo(codecType, expected)) {
						diagnostics.push({ ...diagnosticBase, reason: 'incompatible-domain-codec' });
					}
				} else if (normalizeType) {
					normalize++;
				} else if (simpleUnboundedPrimitive(stateType)) {
					simple++;
				} else {
					diagnostics.push({ ...diagnosticBase, reason: 'missing-domain-codec' });
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(sourceFile);
	}

	return { corpus: 'tsconfig-src', sourceFiles, total, simple, codec, normalize, diagnostics };
}

export function loadHaloStorageBoundaryProgram(workspaceRoot: string): ts.Program {
	const configPath = ts.findConfigFile(
		resolve(workspaceRoot, 'apps/extension-halo'),
		ts.sys.fileExists,
		'tsconfig.json',
	);
	if (!configPath) throw new Error('HALO tsconfig.json was not found');
	const config = ts.readConfigFile(configPath, ts.sys.readFile);
	if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
	const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, resolve(workspaceRoot, 'apps/extension-halo'));
	return ts.createProgram(parsed.fileNames, parsed.options);
}

if (import.meta.main) {
	const workspaceRoot = resolve(import.meta.dir, '..');
	const audit = auditHaloStorageBoundaries(
		loadHaloStorageBoundaryProgram(workspaceRoot),
		resolve(workspaceRoot, 'apps/extension-halo/src'),
	);
	for (const diagnostic of audit.diagnostics) {
		console.error(`${diagnostic.file}:${diagnostic.line} ${diagnostic.reason}: ${diagnostic.stateType}`);
	}
	console.log(`HALO storage state: corpus=${audit.corpus} files=${audit.sourceFiles} total=${audit.total} simple=${audit.simple} codec=${audit.codec} normalize=${audit.normalize} rejected=${audit.diagnostics.length}`);
	if (audit.diagnostics.length > 0) process.exitCode = 1;
}
