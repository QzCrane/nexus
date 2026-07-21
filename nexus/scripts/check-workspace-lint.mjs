import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { BIOME_VERSION } from './toolchain-versions.mjs';
import { RELEASE_STEPS } from './release-spectra.mjs';

const BASELINE_SCHEMA_VERSION = 1;
const BASELINE_ID = 'halo-biome-scope-exception-v1';
const EXPECTED_BIOME_VERSION = BIOME_VERSION;
const MAX_BUFFER_BYTES = 32 * 1024 * 1024;
const UPDATE_FLAG = '--update-halo-baseline';
const ACKNOWLEDGE_FLAG = '--acknowledge-halo-scope-exception';

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const baselinePath = resolve(workspaceDir, 'scripts/baselines/halo-biome-baseline.v1.json');
const biomeConfigPath = resolve(workspaceDir, 'biome.json');

const HALO_TARGETS = Object.freeze([
	'apps/extension-halo/src',
	'apps/extension-halo/public',
	'apps/extension-halo/build.mjs',
]);
const UI_KIT_TARGETS = Object.freeze(['packages/ui-kit/src']);
const TURBO_LINT_WORKSPACES = Object.freeze([
	['@nexus/audio-engine', 'packages/features/audio-engine'],
	['@nexus/contracts', 'packages/contracts'],
	['@nexus/extension-spectra', 'apps/extension-spectra'],
	['@nexus/kernel', 'packages/nexus-kernel'],
]);
const ROOT_FALLBACK_WORKSPACES = Object.freeze([
	['@nexus/extension-halo', 'apps/extension-halo'],
	['@nexus/ui-kit', 'packages/ui-kit'],
]);
const SEVERITY_RANK = new Map([
	['info', 1],
	['warning', 2],
	['error', 3],
]);

function readJson(path, label) {
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch (error) {
		throw new Error(`Cannot read ${label}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

function compareText(left, right) {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

function biomeConfigDigest() {
	const canonicalText = readFileSync(biomeConfigPath, 'utf8').replace(/\r\n?/gu, '\n');
	return sha256(canonicalText);
}

function portableRepoPath(value) {
	const input = String(value).trim();
	const repoRelative = isAbsolute(input) ? relative(workspaceDir, input) : input;
	const portable = repoRelative.replaceAll('\\', '/').replace(/^\.\//u, '');
	if (!portable || portable === '..' || portable.startsWith('../') || portable.includes('/../')) {
		throw new Error(`Path escapes the workspace: ${value}`);
	}
	return portable;
}

function spawnBun(args, label) {
	const result = spawnSync(process.execPath, args, {
		cwd: workspaceDir,
		encoding: 'utf8',
		env: { ...process.env, NO_COLOR: '1' },
		maxBuffer: MAX_BUFFER_BYTES,
		shell: false,
	});
	if (result.error) throw new Error(`${label} could not start: ${result.error.message}`);
	if (result.signal) throw new Error(`${label} terminated by signal ${result.signal}`);
	if (typeof result.status !== 'number') throw new Error(`${label} returned no exit status`);
	return result;
}

function commandFailure(label, result) {
	const detail = [result.stderr, result.stdout].map((value) => value.trim()).filter(Boolean).join('\n');
	return new Error(`${label} failed with exit code ${result.status}${detail ? `:\n${detail}` : ''}`);
}

function actualBiomeVersion() {
	const result = spawnBun(['x', '--bun', 'biome', '--version'], 'Biome version check');
	if (result.status !== 0) throw commandFailure('Biome version check', result);
	const version = result.stdout.match(/\d+\.\d+\.\d+/u)?.[0];
	if (!version) throw new Error(`Biome returned an unrecognized version: ${result.stdout.trim()}`);
	if (version !== EXPECTED_BIOME_VERSION) {
		throw new Error(`Workspace lint requires Biome ${EXPECTED_BIOME_VERSION}, found ${version}`);
	}
	return version;
}

function validateBiomeReport(report, label) {
	if (report?.command !== 'check' || !report.summary || !Array.isArray(report.diagnostics)) {
		throw new Error(`${label} returned an unsupported JSON report`);
	}
	const numericSummaryFields = [
		'changed',
		'unchanged',
		'errors',
		'warnings',
		'infos',
		'skipped',
		'diagnosticsNotPrinted',
	];
	for (const field of numericSummaryFields) {
		const value = report.summary[field];
		if (!Number.isSafeInteger(value) || value < 0) {
			throw new Error(`${label} returned an invalid summary.${field}`);
		}
	}
	if (report.summary.skipped !== 0) {
		throw new Error(`${label} skipped ${report.summary.skipped} files; the lint scan is incomplete`);
	}
	if (report.summary.diagnosticsNotPrinted !== 0) {
		throw new Error(`${label} omitted ${report.summary.diagnosticsNotPrinted} diagnostics`);
	}
	const diagnosticCount = report.summary.errors + report.summary.warnings + report.summary.infos;
	if (report.diagnostics.length !== diagnosticCount) {
		throw new Error(
			`${label} reported ${diagnosticCount} diagnostics but serialized ${report.diagnostics.length}`,
		);
	}
}

function runBiomeJson(targets, label) {
	const result = spawnBun(
		[
			'x',
			'--bun',
			'biome',
			'check',
			...targets,
			'--reporter=json',
			'--max-diagnostics=none',
			'--colors=off',
		],
		label,
	);
	let report;
	try {
		report = JSON.parse(result.stdout);
	} catch (error) {
		const detail = result.stderr.trim();
		throw new Error(
			`${label} returned invalid JSON${detail ? `: ${detail}` : ''}; ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
	validateBiomeReport(report, label);
	const expectedStatus = report.summary.errors > 0 ? 1 : 0;
	if (result.status !== expectedStatus) {
		throw new Error(
			`${label} returned exit ${result.status}; report contents require exit ${expectedStatus}`,
		);
	}
	return { report, status: result.status };
}

function runBiomeProcessedFileScan(targets, expectedStatus, expectedCount, label) {
	const result = spawnBun(
		[
			'x',
			'--bun',
			'biome',
			'check',
			...targets,
			'--reporter=summary',
			'--max-diagnostics=none',
			'--colors=off',
			'--verbose',
		],
		label,
	);
	if (result.status !== expectedStatus) {
		throw new Error(`${label} returned exit ${result.status}; expected ${expectedStatus}`);
	}

	const files = [];
	let inProcessedFiles = false;
	let foundProcessedFilesHeader = false;
	let foundFilesFixedHeader = false;
	for (const rawLine of result.stdout.split(/\r?\n/u)) {
		const line = rawLine;
		if (line.includes('Files processed:')) {
			inProcessedFiles = true;
			foundProcessedFilesHeader = true;
			continue;
		}
		if (inProcessedFiles && line.includes('Files fixed:')) {
			foundFilesFixedHeader = true;
			break;
		}
		if (!inProcessedFiles) continue;
		const match = line.match(/^\s*-\s+(.+?)\s*$/u);
		if (match) files.push(portableRepoPath(match[1]));
	}
	if (!foundProcessedFilesHeader || !foundFilesFixedHeader) {
		throw new Error(`${label} did not expose a complete processed-file section`);
	}
	const uniqueFiles = [...new Set(files)].sort();
	if (uniqueFiles.length !== files.length) throw new Error(`${label} reported duplicate processed files`);
	if (uniqueFiles.length !== expectedCount) {
		throw new Error(
			`${label} JSON reported ${expectedCount} checked files but verbose scan listed ${uniqueFiles.length}`,
		);
	}
	return uniqueFiles;
}

function point(value) {
	return {
		line: Number.isSafeInteger(value?.line) ? value.line : null,
		column: Number.isSafeInteger(value?.column) ? value.column : null,
	};
}

function diagnosticRecord(diagnostic) {
	if (!SEVERITY_RANK.has(diagnostic.severity)) {
		throw new Error(`Biome returned an unsupported severity: ${diagnostic.severity}`);
	}
	if (
		typeof diagnostic.category !== 'string'
		|| typeof diagnostic.message !== 'string'
		|| typeof diagnostic.location?.path !== 'string'
	) {
		throw new Error('Biome returned an incomplete diagnostic');
	}
	const path = portableRepoPath(diagnostic.location.path);
	const start = point(diagnostic.location.start);
	const end = point(diagnostic.location.end);
	const identity = [path, diagnostic.category, diagnostic.message, start.line, start.column, end.line, end.column];
	return {
		fingerprint: sha256(JSON.stringify(identity)),
		severity: diagnostic.severity,
		path,
		category: diagnostic.category,
		message: diagnostic.message,
		range: [start.line, start.column, end.line, end.column],
	};
}

function diagnosticRecords(report) {
	const records = report.diagnostics
		.map(diagnosticRecord)
		.sort((left, right) => compareText(left.fingerprint, right.fingerprint));
	const fingerprints = new Set(records.map((record) => record.fingerprint));
	if (fingerprints.size !== records.length) {
		throw new Error('Biome returned duplicate diagnostic fingerprints; refusing an ambiguous baseline');
	}
	return records;
}

function categorySummary(records) {
	const counts = new Map();
	for (const record of records) counts.set(record.category, (counts.get(record.category) ?? 0) + 1);
	return [...counts.entries()]
		.sort(([left], [right]) => compareText(left, right))
		.map(([category, count]) => ({ category, count }));
}

function buildBaseline(report, processedFiles, biomeVersion) {
	const diagnostics = diagnosticRecords(report);
	return {
		schemaVersion: BASELINE_SCHEMA_VERSION,
		baselineId: BASELINE_ID,
		scopeException: {
			scope: '@nexus/extension-halo',
			reason: 'SPECTRA release work explicitly excludes modifications under apps/extension-halo.',
			policy: 'Existing Halo diagnostics are grandfathered only. New diagnostics, severity upgrades, a reduced processed-file set, tool drift, configuration drift, or an abnormal Biome execution fail the gate.',
			updateCommand: `bun scripts/check-workspace-lint.mjs ${UPDATE_FLAG} ${ACKNOWLEDGE_FLAG}`,
		},
		biomeVersion,
		biomeConfigSha256: biomeConfigDigest(),
		scanTargets: [...HALO_TARGETS],
		summary: {
			checkedFiles: processedFiles.length,
			diagnostics: diagnostics.length,
			errors: report.summary.errors,
			warnings: report.summary.warnings,
			infos: report.summary.infos,
		},
		categories: categorySummary(diagnostics),
		processedFiles,
		diagnostics,
	};
}

function assertSortedUnique(values, label) {
	if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
		throw new Error(`${label} must be an array of strings`);
	}
	const sorted = [...values].sort();
	if (new Set(values).size !== values.length || values.some((value, index) => value !== sorted[index])) {
		throw new Error(`${label} must be sorted and unique`);
	}
}

function validateBaseline(baseline, biomeVersion) {
	if (baseline.schemaVersion !== BASELINE_SCHEMA_VERSION || baseline.baselineId !== BASELINE_ID) {
		throw new Error('Halo Biome baseline has an unsupported schema or identifier');
	}
	if (baseline.scopeException?.scope !== '@nexus/extension-halo') {
		throw new Error('Halo Biome baseline is missing its explicit scope-exception marker');
	}
	if (baseline.biomeVersion !== biomeVersion) {
		throw new Error(`Halo baseline expects Biome ${baseline.biomeVersion}; found ${biomeVersion}`);
	}
	if (baseline.biomeConfigSha256 !== biomeConfigDigest()) {
		throw new Error('biome.json changed; review the Halo scope exception and explicitly regenerate its baseline');
	}
	if (JSON.stringify(baseline.scanTargets) !== JSON.stringify(HALO_TARGETS)) {
		throw new Error('Halo baseline scan targets do not match the enforced targets');
	}
	assertSortedUnique(baseline.processedFiles, 'Halo baseline processedFiles');
	if (!Array.isArray(baseline.diagnostics) || !Array.isArray(baseline.categories)) {
		throw new Error('Halo baseline is missing diagnostic or category records');
	}

	const fingerprints = [];
	const severityCounts = { error: 0, warning: 0, info: 0 };
	for (const record of baseline.diagnostics) {
		if (
			typeof record.fingerprint !== 'string'
			|| !/^[a-f0-9]{64}$/u.test(record.fingerprint)
			|| !SEVERITY_RANK.has(record.severity)
			|| typeof record.path !== 'string'
			|| typeof record.category !== 'string'
			|| typeof record.message !== 'string'
			|| !Array.isArray(record.range)
			|| record.range.length !== 4
		) {
			throw new Error('Halo baseline contains an invalid diagnostic record');
		}
		const [startLine, startColumn, endLine, endColumn] = record.range;
		const identity = [
			portableRepoPath(record.path),
			record.category,
			record.message,
			startLine,
			startColumn,
			endLine,
			endColumn,
		];
		if (record.fingerprint !== sha256(JSON.stringify(identity))) {
			throw new Error(`Halo baseline fingerprint is invalid for ${record.path}`);
		}
		fingerprints.push(record.fingerprint);
		severityCounts[record.severity] += 1;
	}
	assertSortedUnique(fingerprints, 'Halo baseline fingerprints');

	const summary = baseline.summary;
	if (
		!summary
		|| summary.checkedFiles !== baseline.processedFiles.length
		|| summary.diagnostics !== baseline.diagnostics.length
		|| summary.errors !== severityCounts.error
		|| summary.warnings !== severityCounts.warning
		|| summary.infos !== severityCounts.info
	) {
		throw new Error('Halo baseline summary does not match its records');
	}
	if (JSON.stringify(baseline.categories) !== JSON.stringify(categorySummary(baseline.diagnostics))) {
		throw new Error('Halo baseline category summary does not match its records');
	}
}

function parseTurboWorkspaces() {
	const result = spawnBun(['x', '--bun', 'turbo', 'ls', '--output=json'], 'Turbo workspace discovery');
	if (result.status !== 0) throw commandFailure('Turbo workspace discovery', result);
	let report;
	try {
		report = JSON.parse(result.stdout);
	} catch (error) {
		throw new Error(
			`Turbo workspace discovery returned invalid JSON: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
	if (!Array.isArray(report.packages?.items)) {
		throw new Error('Turbo workspace discovery returned an unsupported report');
	}
	return new Map(report.packages.items.map((item) => [item.name, portableRepoPath(item.path)]));
}

function assertWorkspaceCoverage() {
	const discovered = parseTurboWorkspaces();
	const expected = new Map([...TURBO_LINT_WORKSPACES, ...ROOT_FALLBACK_WORKSPACES]);
	const missingCoverage = [...discovered.keys()].filter((name) => !expected.has(name));
	const missingWorkspace = [...expected.keys()].filter((name) => !discovered.has(name));
	if (missingCoverage.length > 0 || missingWorkspace.length > 0) {
		throw new Error(
			`Workspace lint coverage drifted; uncovered: ${missingCoverage.join(', ') || 'none'}; missing: ${
				missingWorkspace.join(', ') || 'none'
			}`,
		);
	}
	for (const [name, expectedPath] of expected) {
		if (discovered.get(name) !== expectedPath) {
			throw new Error(`${name} moved from ${expectedPath} to ${discovered.get(name)}`);
		}
	}

	const rootManifest = readJson(resolve(workspaceDir, 'package.json'), 'root package.json');
	const rootLint = rootManifest.scripts?.lint;
	if (typeof rootLint !== 'string' || !rootLint.includes('bun run lint:workspace-fallbacks')) {
		throw new Error('Root lint does not invoke lint:workspace-fallbacks');
	}
	for (const [name, packagePath] of TURBO_LINT_WORKSPACES) {
		const manifest = readJson(resolve(workspaceDir, packagePath, 'package.json'), `${name} package.json`);
		if (typeof manifest.scripts?.lint !== 'string' || !manifest.scripts.lint.trim()) {
			throw new Error(`${name} does not define a real lint script`);
		}
		if (!rootLint.includes(`--filter=${name}`)) {
			throw new Error(`Root lint does not select ${name}`);
		}
	}
	const fallbackScript = rootManifest.scripts?.['lint:workspace-fallbacks'];
	if (fallbackScript !== 'bun scripts/check-workspace-lint.mjs') {
		throw new Error('lint:workspace-fallbacks must invoke the version-controlled workspace lint gate');
	}
	const releaseRunsRootLint = RELEASE_STEPS.some((step) => step.label === 'Biome lint');
	if (!releaseRunsRootLint) throw new Error('SPECTRA release does not invoke the root lint gate');
	return discovered.size;
}

function formatDiagnostic(record) {
	const [line, column] = record.range;
	const location = line === null ? record.path : `${record.path}:${line}:${column ?? 0}`;
	return `${record.severity} ${location} ${record.category}: ${record.message}`;
}

function enforceHaloBaseline(baseline, report, processedFiles) {
	const currentDiagnostics = diagnosticRecords(report);
	const baselineFiles = new Set(baseline.processedFiles);
	const currentFiles = new Set(processedFiles);
	const missingFiles = [...baselineFiles].filter((path) => !currentFiles.has(path));
	const baselineDiagnostics = new Map(
		baseline.diagnostics.map((record) => [record.fingerprint, record]),
	);
	const currentByFingerprint = new Map(
		currentDiagnostics.map((record) => [record.fingerprint, record]),
	);
	const newDiagnostics = currentDiagnostics.filter((record) => !baselineDiagnostics.has(record.fingerprint));
	const severityUpgrades = currentDiagnostics.filter((record) => {
		const previous = baselineDiagnostics.get(record.fingerprint);
		return previous && SEVERITY_RANK.get(record.severity) > SEVERITY_RANK.get(previous.severity);
	});
	const resolvedDiagnostics = baseline.diagnostics.filter(
		(record) => !currentByFingerprint.has(record.fingerprint),
	);

	const failures = [];
	if (missingFiles.length > 0) {
		failures.push(
			`processed-file set shrank by ${missingFiles.length}:\n${missingFiles.slice(0, 20).join('\n')}`,
		);
	}
	if (newDiagnostics.length > 0) {
		failures.push(
			`new diagnostics (${newDiagnostics.length}):\n${newDiagnostics
				.slice(0, 20)
				.map(formatDiagnostic)
				.join('\n')}`,
		);
	}
	if (severityUpgrades.length > 0) {
		failures.push(
			`severity upgrades (${severityUpgrades.length}):\n${severityUpgrades
				.slice(0, 20)
				.map(formatDiagnostic)
				.join('\n')}`,
		);
	}
	if (failures.length > 0) {
		throw new Error(`Halo scope-exception baseline rejected the scan:\n${failures.join('\n\n')}`);
	}
	const baselineCount = baseline.diagnostics.length;
	const currentCount = currentDiagnostics.length;
	if (baselineCount > 0 && currentCount < baselineCount) {
		const reduction = (baselineCount - currentCount) / baselineCount;
		if (reduction >= 0.10) {
			console.log(
				`ℹ Halo diagnostics reduced by ${(reduction * 100).toFixed(1)}% ` +
					`(${baselineCount} → ${currentCount}); consider updating the baseline ` +
					`with bun scripts/check-workspace-lint.mjs ${UPDATE_FLAG} ${ACKNOWLEDGE_FLAG}`,
			);
		}
	}
	return {
		currentDiagnostics: currentDiagnostics.length,
		resolvedDiagnostics: resolvedDiagnostics.length,
		currentFiles: processedFiles.length,
	};
}

function parseArguments() {
	const args = process.argv.slice(2);
	const allowed = new Set([UPDATE_FLAG, ACKNOWLEDGE_FLAG]);
	const unknown = args.filter((arg) => !allowed.has(arg));
	if (unknown.length > 0) throw new Error(`Unknown option(s): ${unknown.join(', ')}`);
	const update = args.includes(UPDATE_FLAG);
	const acknowledged = args.includes(ACKNOWLEDGE_FLAG);
	if (update !== acknowledged) {
		throw new Error(`Baseline updates require both ${UPDATE_FLAG} and ${ACKNOWLEDGE_FLAG}`);
	}
	return { update };
}

function main() {
	const startedAt = performance.now();
	const { update } = parseArguments();
	const biomeVersion = actualBiomeVersion();
	const workspaceCount = assertWorkspaceCoverage();

	const uiKit = runBiomeJson(UI_KIT_TARGETS, 'ui-kit strict Biome check');
	if (uiKit.status !== 0) {
		const details = uiKit.report.diagnostics.slice(0, 20).map(diagnosticRecord).map(formatDiagnostic).join('\n');
		throw new Error(`ui-kit strict Biome check failed:\n${details}`);
	}

	const halo = runBiomeJson(HALO_TARGETS, 'Halo Biome baseline scan');
	const haloCheckedFiles = halo.report.summary.changed + halo.report.summary.unchanged;
	const haloProcessedFiles = runBiomeProcessedFileScan(
		HALO_TARGETS,
		halo.status,
		haloCheckedFiles,
		'Halo Biome processed-file scan',
	);

	let haloResult;
	if (update) {
		const baseline = buildBaseline(halo.report, haloProcessedFiles, biomeVersion);
		mkdirSync(dirname(baselinePath), { recursive: true });
		writeFileSync(baselinePath, `${JSON.stringify(baseline, null, '\t')}\n`, 'utf8');
		haloResult = {
			currentDiagnostics: baseline.summary.diagnostics,
			resolvedDiagnostics: 0,
			currentFiles: baseline.summary.checkedFiles,
		};
		console.log(`✓ Updated ${portableRepoPath(baselinePath)} as an explicit Halo scope exception`);
	} else {
		const baseline = readJson(baselinePath, 'Halo Biome baseline');
		validateBaseline(baseline, biomeVersion);
		haloResult = enforceHaloBaseline(baseline, halo.report, haloProcessedFiles);
	}

	const elapsedMs = Math.round(performance.now() - startedAt);
	console.log(`✓ Workspace lint coverage: ${workspaceCount} Turbo workspaces`);
	console.log(
		`✓ ui-kit strict Biome: ${uiKit.report.summary.changed + uiKit.report.summary.unchanged} files, ${
			uiKit.report.summary.errors
		} errors, ${uiKit.report.summary.warnings} warnings`,
	);
	console.log(
		`✓ Halo scope exception: ${haloResult.currentFiles} files, ${halo.report.summary.errors} errors, ${
			halo.report.summary.warnings
		} warnings, ${halo.report.summary.infos} infos; ${haloResult.currentDiagnostics} diagnostics, ${
			haloResult.resolvedDiagnostics
		} resolved from baseline`,
	);
	console.log(`✓ Workspace fallback lint gate completed in ${elapsedMs}ms`);
}

try {
	main();
} catch (error) {
	console.error(`✗ Workspace fallback lint gate failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
}
