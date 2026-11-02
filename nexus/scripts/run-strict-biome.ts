import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript-compiler-api';

const MAX_BUFFER_BYTES = 32 * 1024 * 1024;
const BIOME_LINT_EXTENSIONS = new Set([
	'.astro',
	'.cjs',
	'.cts',
	'.css',
	'.gql',
	'.graphql',
	'.html',
	'.js',
	'.json',
	'.jsonc',
	'.jsx',
	'.mjs',
	'.ts',
	'.mts',
	'.svelte',
	'.ts',
	'.tsx',
	'.vue',
]);
const SCRIPT_EXTENSIONS = new Set([
	'.cjs',
	'.cts',
	'.js',
	'.jsx',
	'.mjs',
	'.ts',
	'.mts',
	'.ts',
	'.tsx',
]);
const SKIPPED_DIRECTORY_NAMES = new Set([
	'.cache',
	'.git',
	'.playwright-user-data',
	'.turbo',
	'assets-backup',
	'build',
	'coverage',
	'dist',
	'node_modules',
	'playwright-report',
	'release',
	'test-results',
	'vendor',
]);
const targets = process.argv.slice(2);

function isPathInside(parent, candidate) {
	const relativePath = path.relative(parent, candidate);
	return (
		Boolean(relativePath) &&
		!path.isAbsolute(relativePath) &&
		relativePath !== '..' &&
		!relativePath.startsWith(`..${path.sep}`)
	);
}

// biome.json owns the lint scope: vendor, dist, caches, and generated output
// directories are excluded there. A target that names one of those paths (or a
// file inside one) contributes no expected files, whether it arrives as a
// directory or as an explicit staged file. Deriving this from the same path
// segment set keeps the expected-file count identical to Biome's real scan.
function isScopeExcluded(absolutePath, repositoryRoot) {
	const relativePath = path.relative(fs.realpathSync(repositoryRoot), absolutePath);
	return relativePath.split(path.sep).some((segment) => SKIPPED_DIRECTORY_NAMES.has(segment));
}

function canonicalPathKey(value) {
	const normalized = path.normalize(value);
	return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function findRepositoryRoot(start = path.dirname(fileURLToPath(import.meta.url))) {
	let current = path.resolve(start);
	for (;;) {
		if (fs.existsSync(path.join(current, '.git'))) return current;
		const parent = path.dirname(current);
		if (parent === current) {
			throw new Error(`Strict Biome could not locate a Git repository above ${start}`);
		}
		current = parent;
	}
}

function validateTargets(
	values,
	cwd = process.cwd(),
	repositoryRoot = findRepositoryRoot(),
) {
	if (values.length === 0) throw new Error('Strict Biome requires at least one target');
	const option = values.find((value) => value.startsWith('-'));
	if (option) {
		throw new Error(`Strict Biome targets cannot inject Biome options: ${option}`);
	}
	const canonicalRepositoryRoot = fs.realpathSync(repositoryRoot);
	const canonicalTargets = [];
	for (const value of values) {
		const absolutePath = path.resolve(cwd, value);
		const relativePath = path.relative(repositoryRoot, absolutePath);
		if (
			!relativePath ||
			path.isAbsolute(relativePath) ||
			!isPathInside(repositoryRoot, absolutePath)
		) {
			throw new Error(`Strict Biome target escapes or equals the repository root: ${value}`);
		}
		if (!fs.existsSync(absolutePath)) {
			throw new Error(`Strict Biome target does not exist: ${value}`);
		}
		const canonicalTarget = fs.realpathSync(absolutePath);
		const canonicalRelativePath = path.relative(
			canonicalRepositoryRoot,
			canonicalTarget,
		);
		if (
			!canonicalRelativePath ||
			path.isAbsolute(canonicalRelativePath) ||
			!isPathInside(canonicalRepositoryRoot, canonicalTarget)
		) {
			throw new Error(
				`Strict Biome target resolves outside or to the repository root: ${value}`,
			);
		}
		if (fs.lstatSync(absolutePath).isSymbolicLink()) {
			throw new Error(`Strict Biome target cannot be a symbolic link: ${value}`);
		}
		const normalized = canonicalPathKey(canonicalTarget);
		for (const existing of canonicalTargets) {
			if (normalized === existing.key) {
				throw new Error(`Strict Biome target is duplicated after normalization: ${value}`);
			}
			if (
				isPathInside(existing.path, canonicalTarget) ||
				isPathInside(canonicalTarget, existing.path)
			) {
				throw new Error(
					`Strict Biome targets overlap after normalization: ${existing.value} and ${value}`,
				);
			}
		}
		canonicalTargets.push({
			key: normalized,
			path: canonicalTarget,
			value,
		});
	}
}

function validateReport(report) {
	if (report?.command !== 'check' || !report.summary || !Array.isArray(report.diagnostics)) {
		throw new Error('Biome returned an unsupported JSON report');
	}
	const fields = [
		'changed',
		'unchanged',
		'errors',
		'warnings',
		'infos',
		'skipped',
		'diagnosticsNotPrinted',
	];
	for (const field of fields) {
		if (!Number.isSafeInteger(report.summary[field]) || report.summary[field] < 0) {
			throw new Error(`Biome returned an invalid summary.${field}`);
		}
	}
	if (report.summary.changed + report.summary.unchanged === 0) {
		throw new Error('Biome checked zero files');
	}
	const diagnosticCount = report.summary.errors + report.summary.warnings + report.summary.infos;
	if (diagnosticCount !== report.diagnostics.length) {
		throw new Error(
			`Biome reported ${diagnosticCount} diagnostics but serialized ${report.diagnostics.length}`,
		);
	}
	if (report.summary.skipped !== 0) {
		throw new Error(`Biome skipped ${report.summary.skipped} files; the lint scan is incomplete`);
	}
	if (report.summary.diagnosticsNotPrinted !== 0) {
		throw new Error(`Biome omitted ${report.summary.diagnosticsNotPrinted} diagnostics`);
	}
}

function formatDiagnostic(diagnostic) {
	const path = diagnostic.location?.path ?? '<unknown>';
	const line = diagnostic.location?.start?.line;
	const column = diagnostic.location?.start?.column;
	const location = Number.isSafeInteger(line) ? `${path}:${line}:${column ?? 0}` : path;
	return `${diagnostic.severity} ${location} ${diagnostic.category ?? '<uncategorized>'}: ${
		diagnostic.message ?? '<no message>'
	}`;
}

function validateZeroDiagnosticReport(report, expectedFileCount) {
	validateReport(report);
	const processedFileCount = report.summary.changed + report.summary.unchanged;
	if (expectedFileCount !== undefined) {
		if (!Number.isSafeInteger(expectedFileCount) || expectedFileCount <= 0) {
			throw new Error('Strict Biome received an invalid expected file count');
		}
		if (processedFileCount !== expectedFileCount) {
			throw new Error(
				`Biome processed ${processedFileCount} of ${expectedFileCount} expected files; ` +
					'the lint scan omitted or unexpectedly added files',
			);
		}
	}
	const diagnostics = report.diagnostics.map(formatDiagnostic);
	if (diagnostics.length > 0) {
		throw new Error(
			`Biome emitted ${report.summary.errors} errors, ${report.summary.warnings} warnings, and ${
				report.summary.infos
			} infos:\n${diagnostics.join('\n')}`,
		);
	}
}

function isSideEffectFreeExpression(node) {
	if (ts.isParenthesizedExpression(node)) {
		return isSideEffectFreeExpression(node.expression);
	}
	if (
		ts.isNumericLiteral(node) ||
		ts.isStringLiteral(node) ||
		node.kind === ts.SyntaxKind.NullKeyword ||
		node.kind === ts.SyntaxKind.TrueKeyword ||
		node.kind === ts.SyntaxKind.FalseKeyword
	) {
		return true;
	}
	return ts.isIdentifier(node) && node.text === 'undefined';
}

function isNoOpStatement(node) {
	if (ts.isEmptyStatement(node)) return true;
	if (ts.isBlock(node)) return node.statements.every(isNoOpStatement);
	if (ts.isLabeledStatement(node)) return isNoOpStatement(node.statement);
	if (!ts.isExpressionStatement(node)) return false;
	const expression = node.expression;
	if (isSideEffectFreeExpression(expression)) return true;
	return (
		ts.isVoidExpression(expression) &&
		isSideEffectFreeExpression(expression.expression)
	);
}

function isNoOpBlock(block) {
	return block.statements.every(isNoOpStatement);
}

function findEmptyCatchBlocks(source, fileName = 'source.ts') {
	const sourceFile = ts.createSourceFile(
		fileName,
		source,
		ts.ScriptTarget.Latest,
		true,
		fileName.endsWith('.tsx') || fileName.endsWith('.jsx')
			? ts.ScriptKind.TSX
			: ts.ScriptKind.TS,
	);
	const violations = [];
	const visit = (node) => {
		if (ts.isCatchClause(node) && isNoOpBlock(node.block)) {
			const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
			violations.push({ line: start.line + 1, column: start.character + 1 });
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return violations;
}

function findEmptyRejectionHandlers(source, fileName = 'source.ts') {
	const sourceFile = ts.createSourceFile(
		fileName,
		source,
		ts.ScriptTarget.Latest,
		true,
		fileName.endsWith('.tsx') || fileName.endsWith('.jsx')
			? ts.ScriptKind.TSX
			: ts.ScriptKind.TS,
	);
	const violations = [];
	const isEmptyCallback = (node) => {
		if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) {
			return false;
		}
		return ts.isBlock(node.body) && isNoOpBlock(node.body);
	};
	const visit = (node) => {
		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression)
		) {
			const method = node.expression.name.text;
			const rejectionHandler =
				method === 'catch'
					? node.arguments[0]
					: method === 'then'
						? node.arguments[1]
						: undefined;
			if (rejectionHandler && isEmptyCallback(rejectionHandler)) {
				const start = sourceFile.getLineAndCharacterOfPosition(
					rejectionHandler.getStart(sourceFile),
				);
				violations.push({ line: start.line + 1, column: start.character + 1 });
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return violations;
}

function collectBiomeFiles(
	targetValues,
	cwd = process.cwd(),
	repositoryRoot = findRepositoryRoot(),
) {
	const canonicalRepositoryRoot = fs.realpathSync(repositoryRoot);
	const fileKeys = new Set();
	const collectedFiles = [];
	const visit = (absolutePath, targetFiles) => {
		const stats = fs.statSync(absolutePath);
		if (stats.isDirectory()) {
			if (SKIPPED_DIRECTORY_NAMES.has(path.basename(absolutePath))) return;
			for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
				if (entry.isDirectory() && SKIPPED_DIRECTORY_NAMES.has(entry.name)) continue;
				const entryPath = path.join(absolutePath, entry.name);
				if (entry.isSymbolicLink()) {
					throw new Error(
						`Strict Biome target contains an unsupported symbolic link: ${path
							.relative(cwd, entryPath)
							.replaceAll(path.sep, '/')}`,
					);
				}
				if (!entry.isDirectory() && !entry.isFile()) {
					throw new Error(
						`Strict Biome target contains an unsupported filesystem entry: ${path
							.relative(cwd, entryPath)
							.replaceAll(path.sep, '/')}`,
					);
				}
				visit(entryPath, targetFiles);
			}
			return;
		}
		if (!stats.isFile() || !BIOME_LINT_EXTENSIONS.has(path.extname(absolutePath))) {
			return;
		}
		if (isScopeExcluded(absolutePath, repositoryRoot)) return;
		const canonicalFile = fs.realpathSync(absolutePath);
		if (!isPathInside(canonicalRepositoryRoot, canonicalFile)) {
			throw new Error(
				`Strict Biome target file resolves outside the repository: ${path
					.relative(cwd, absolutePath)
					.replaceAll(path.sep, '/')}`,
			);
		}
		const key = canonicalPathKey(canonicalFile);
		if (fileKeys.has(key)) {
			throw new Error(
				`Strict Biome target files overlap after normalization: ${path
					.relative(cwd, absolutePath)
					.replaceAll(path.sep, '/')}`,
			);
		}
		fileKeys.add(key);
		targetFiles.push(canonicalFile);
	};

	for (const target of targetValues) {
		const absolutePath = fs.realpathSync(path.resolve(cwd, target));
		if (isScopeExcluded(absolutePath, repositoryRoot)) continue;
		const targetFiles = [];
		visit(absolutePath, targetFiles);
		if (targetFiles.length === 0) {
			throw new Error(
				`Strict Biome target contributes no supported lint files: ${target}`,
			);
		}
		collectedFiles.push(...targetFiles);
	}
	return collectedFiles.sort();
}

function collectScriptFiles(
	targetValues,
	cwd = process.cwd(),
	repositoryRoot = findRepositoryRoot(),
) {
	return collectBiomeFiles(targetValues, cwd, repositoryRoot).filter((file) =>
		SCRIPT_EXTENSIONS.has(path.extname(file)),
	);
}

function validateNoEmptyCatchesInFiles(files, cwd = process.cwd()) {
	const violations = [];
	for (const file of files) {
		if (!SCRIPT_EXTENSIONS.has(path.extname(file))) continue;
		const source = fs.readFileSync(file, 'utf8');
		for (const location of findEmptyCatchBlocks(source, file)) {
			violations.push({
				path: path.relative(cwd, file).replaceAll(path.sep, '/'),
				kind: 'empty catch block',
				...location,
			});
		}
		for (const location of findEmptyRejectionHandlers(source, file)) {
			violations.push({
				path: path.relative(cwd, file).replaceAll(path.sep, '/'),
				kind: 'empty rejection handler',
				...location,
			});
		}
	}
	if (violations.length > 0) {
		throw new Error(
			`Source contract rejected ${violations.length} silent failure handler${
				violations.length === 1 ? '' : 's'
			}; handle, report, or structurally avoid the failure:\n${
				violations
					.map(
						({ path: file, line, column, kind }) =>
							`${file}:${line}:${column} ${kind}`,
					)
					.join('\n')
			}`,
		);
	}
}

function validateNoEmptyCatches(
	targetValues,
	cwd = process.cwd(),
	repositoryRoot = findRepositoryRoot(),
) {
	validateNoEmptyCatchesInFiles(
		collectScriptFiles(targetValues, cwd, repositoryRoot),
		cwd,
	);
}

// Bound native process arguments by characters rather than file count. The
// doubled cost covers Windows quoting/backslash expansion; 16 KiB leaves room
// for the executable and fixed flags without approaching its command limit.
function partitionBiomeFileArguments(fileArguments, maximumCharacters = 16 * 1024) {
	const batches = [];
	let current = [];
	let characters = 0;
	for (const argument of fileArguments) {
		const cost = 2 * argument.length + 3;
		if (cost > maximumCharacters) throw new Error(`Biome file argument is too long: ${argument}`);
		if (characters + cost > maximumCharacters) {
			batches.push(current);
			current = [];
			characters = 0;
		}
		current.push(argument);
		characters += cost;
	}
	if (current.length > 0) batches.push(current);
	return batches;
}

function runBiomeBatch(fileArguments) {
	const result = spawnSync(
		process.execPath,
		[
			'x',
			'--bun',
			'biome',
			'check',
			...fileArguments,
			'--reporter=json',
			'--max-diagnostics=none',
			'--colors=off',
		],
		{
			cwd: process.cwd(),
			encoding: 'utf8',
			env: { ...process.env, NO_COLOR: '1' },
			maxBuffer: MAX_BUFFER_BYTES,
			shell: false,
		},
	);
	if (result.error) throw new Error(`Biome could not start: ${result.error.message}`);
	if (result.signal) throw new Error(`Biome terminated by signal ${result.signal}`);
	if (typeof result.status !== 'number') throw new Error('Biome returned no exit status');

	let report: unknown;
	try {
		report = JSON.parse(result.stdout);
	} catch (error) {
		const detail = result.stderr.trim();
		throw new Error(
			`Biome returned invalid JSON${detail ? `: ${detail}` : ''}; ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
	validateZeroDiagnosticReport(report, fileArguments.length);
	if (result.status !== 0) {
		const detail = result.stderr.trim();
		throw new Error(`Biome returned exit ${result.status} without diagnostics${detail ? `: ${detail}` : ''}`);
	}
}


function main() {
	validateTargets(targets);
	const biomeFiles = collectBiomeFiles(targets);
	if (biomeFiles.length === 0) {
		console.log('✓ Strict Biome: no files inside the lint scope for the requested targets');
		return;
	}
	const fileArguments = biomeFiles.map((file) => `.${path.sep}${path.relative(process.cwd(), file)}`);
	for (const batch of partitionBiomeFileArguments(fileArguments)) runBiomeBatch(batch);
	validateNoEmptyCatchesInFiles(biomeFiles);
	console.log(
		`✓ Strict Biome: ${biomeFiles.length} files, 0 diagnostics, 0 silent handlers`,
	);
}

export {
	collectBiomeFiles,
	findEmptyCatchBlocks,
	findEmptyRejectionHandlers,
	partitionBiomeFileArguments,
	validateNoEmptyCatches,
	validateTargets,
	validateZeroDiagnosticReport,
};

if (import.meta.main) {
	try {
		main();
	} catch (error) {
		console.error(`✗ Strict Biome failed: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}
