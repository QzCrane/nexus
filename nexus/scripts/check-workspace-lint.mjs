import { spawnSync } from 'node:child_process';
import {
	existsSync,
	lstatSync,
	readdirSync,
	readFileSync,
	realpathSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const PUBLIC_MODE_OPTION = '--public';
const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryDir = dirname(workspaceDir);
const require = createRequire(import.meta.url);
const PRIVATE_ROOT_LINT =
	'bun scripts/run-lint-parallel.mjs';
const PUBLIC_ROOT_LINT =
	'bun scripts/run-lint-parallel.mjs --public';
const REPOSITORY_LINT_TARGETS = [
	'scripts',
	'package.json',
	'biome.json',
	'tsconfig.base.json',
	'turbo.json',
	'../package.json',
	'../commitlint.config.cjs',
	'../.claude/settings.json',
	'../.codex/hooks.json',
	'../remote-site',
];
const PUBLIC_APPLICATION_LINT_TARGETS = {
	halo: ['.'],
	spectra: ['.'],
};
const EXPECTED_BIOME_INCLUDES = [
	'**',
	'!**/.cache',
	'!**/.playwright-user-data',
	'!**/dist',
	'!**/node_modules',
	'!**/.turbo',
	'!**/assets-backup',
	'!**/build',
	'!**/coverage',
	'!**/playwright-report',
	'!**/release',
	'!**/test-results',
	'!**/vendor',
];
const STRICT_RUNNER_PATH = realpathSync(
	resolve(workspaceDir, 'scripts', 'run-strict-biome.mjs'),
);

function isPathInside(parent, candidate) {
	const relativePath = relative(parent, candidate);
	return (
		Boolean(relativePath) &&
		!isAbsolute(relativePath) &&
		relativePath !== '..' &&
		!relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
	);
}

function canonicalPathKey(value) {
	const canonical = realpathSync(value);
	return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

function readJson(path, label) {
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch (error) {
		throw new Error(`Cannot read ${label}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function portableRepoPath(value, root = workspaceDir) {
	const input = String(value).trim();
	const absolute = resolve(root, input);
	const repoRelative = relative(root, absolute);
	if (
		!input ||
		!repoRelative ||
		isAbsolute(repoRelative) ||
		!isPathInside(root, absolute)
	) {
		throw new Error(`Workspace path escapes the repository: ${value}`);
	}
	if (!existsSync(absolute)) {
		throw new Error(`Workspace path does not exist: ${value}`);
	}
	const canonicalRoot = realpathSync(root);
	const canonicalPath = realpathSync(absolute);
	if (!isPathInside(canonicalRoot, canonicalPath)) {
		throw new Error(`Workspace path resolves outside the repository: ${value}`);
	}
	if (lstatSync(absolute).isSymbolicLink()) {
		throw new Error(`Workspace path cannot be a symbolic link: ${value}`);
	}
	return relative(canonicalRoot, canonicalPath).replaceAll('\\', '/');
}

function discoverWorkspaces() {
	const result = spawnSync(process.execPath, ['x', '--bun', 'turbo', 'ls', '--output=json'], {
		cwd: workspaceDir,
		encoding: 'utf8',
		env: { ...process.env, NO_COLOR: '1' },
		maxBuffer: MAX_BUFFER_BYTES,
		shell: false,
	});
	if (result.error) throw new Error(`Turbo workspace discovery could not start: ${result.error.message}`);
	if (result.signal) throw new Error(`Turbo workspace discovery terminated by signal ${result.signal}`);
	if (result.status !== 0) {
		const detail = [result.stderr, result.stdout]
			.map((value) => value.trim())
			.filter(Boolean)
			.join('\n');
		throw new Error(
			`Turbo workspace discovery failed with exit code ${result.status}${detail ? `:\n${detail}` : ''}`,
		);
	}

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
	if (!Array.isArray(report.packages?.items) || report.packages.items.length === 0) {
		throw new Error('Turbo workspace discovery returned no packages');
	}

	const workspaces = report.packages.items.map((item) => {
		if (typeof item?.name !== 'string' || !item.name.trim() || typeof item.path !== 'string') {
			throw new Error('Turbo workspace discovery returned an incomplete package record');
		}
		return { name: item.name, path: portableRepoPath(item.path) };
	});
	const names = new Set(workspaces.map(({ name }) => name));
	const paths = new Set(workspaces.map(({ path }) => path));
	if (names.size !== workspaces.length || paths.size !== workspaces.length) {
		throw new Error('Turbo workspace discovery returned duplicate names or paths');
	}
	return workspaces.sort((left, right) => left.name.localeCompare(right.name));
}

function parseMode(args) {
	if (args.length === 0) return 'private';
	if (args.length === 1 && args[0] === PUBLIC_MODE_OPTION) return 'public';
	throw new Error(`Workspace lint coverage accepts only the optional ${PUBLIC_MODE_OPTION} mode`);
}

function validateBiomeConfig(config) {
	if (
		config?.root !== true ||
		config?.vcs?.enabled !== false ||
		JSON.stringify(config?.files?.includes) !==
			JSON.stringify(EXPECTED_BIOME_INCLUDES) ||
		config?.linter?.enabled !== true ||
		JSON.stringify(config.linter.rules) !== '{"preset":"recommended"}'
	) {
		throw new Error(
			'biome.json must use explicit targets and the complete recommended preset without global rule overrides',
		);
	}
	if (
		(Object.hasOwn(config, 'extends') && config.extends !== undefined) ||
		(Object.hasOwn(config, 'overrides') && config.overrides !== undefined)
	) {
		throw new Error(
			'biome.json cannot import or declare scope-specific rule overrides',
		);
	}
}

function validateStrictRunnerCommand(
	command,
	commandCwd,
	label,
	expectedTargets,
	targetRoot = commandCwd,
) {
	if (typeof command !== 'string' || !command.trim()) {
		throw new Error(`${label} must define a strict lint command`);
	}
	const normalized = command.trim();
	if (/[\n\r&|;<>()`$]/u.test(normalized)) {
		throw new Error(`${label} must be one non-composite strict runner invocation`);
	}
	const tokens = normalized.split(/\s+/u);
	if (tokens[0] !== 'bun' || tokens.length < 3) {
		throw new Error(`${label} must invoke the strict runner through Bun`);
	}
	const runnerPath = resolve(commandCwd, tokens[1]);
	if (
		!existsSync(runnerPath) ||
		canonicalPathKey(runnerPath) !== canonicalPathKey(STRICT_RUNNER_PATH)
	) {
		throw new Error(`${label} does not resolve to scripts/run-strict-biome.mjs`);
	}

	const canonicalTargetRoot = realpathSync(targetRoot);
	const targetKeys = new Set();
	const commandTargets = tokens.slice(2);
	for (const target of commandTargets) {
		if (target.startsWith('-')) {
			throw new Error(`${label} cannot inject strict runner options`);
		}
		const targetPath = resolve(commandCwd, target);
		if (!existsSync(targetPath)) {
			throw new Error(`${label} target does not exist: ${target}`);
		}
		const canonicalTarget = realpathSync(targetPath);
		if (
			canonicalPathKey(canonicalTarget) !==
				canonicalPathKey(canonicalTargetRoot) &&
			!isPathInside(canonicalTargetRoot, canonicalTarget)
		) {
			throw new Error(`${label} target escapes its owning workspace: ${target}`);
		}
		if (lstatSync(targetPath).isSymbolicLink()) {
			throw new Error(`${label} target cannot be a symbolic link: ${target}`);
		}
		const key = process.platform === 'win32'
			? canonicalTarget.toLowerCase()
			: canonicalTarget;
		if (targetKeys.has(key)) {
			throw new Error(`${label} repeats a target after normalization: ${target}`);
		}
		targetKeys.add(key);
	}
	if (
		expectedTargets &&
		JSON.stringify(commandTargets) !== JSON.stringify(expectedTargets)
	) {
		throw new Error(
			`${label} must lint exactly: ${expectedTargets.join(', ')}`,
		);
	}
	return commandTargets;
}

function validatePrivateHookSource(hookSource) {
	const normalizedHookSource = hookSource.replaceAll('\r\n', '\n');
	const runCommands = [
		...normalizedHookSource.matchAll(/^\s*run:\s*(.+?)\s*$/gmu),
	].map((match) => match[1]);
	const stagedCommand = 'bun scripts/run-strict-biome.mjs {staged_files}';
	if (
		runCommands.filter((command) => command === stagedCommand).length !== 1 ||
		runCommands.some(
			(command) =>
				command !== stagedCommand &&
				/(?:@biomejs\/biome|\bbiome\b)/u.test(command),
		)
	) {
		throw new Error('The staged-file Biome hook must use the zero-diagnostic strict runner');
	}
	const repositoryLintBlocks = [
		...normalizedHookSource.matchAll(
			/^\s*repository-lint:\s*\n\s*run:\s*(.+?)\s*$/gmu,
		),
	];
	if (
		repositoryLintBlocks.length !== 1 ||
		repositoryLintBlocks[0][1] !== 'bun run lint'
	) {
		throw new Error('The pre-push hook must run the complete repository lint owner');
	}
}

function validateRootCommand(mode) {
	const rootManifest = readJson(resolve(workspaceDir, 'package.json'), 'root package.json');
	const turboConfig = readJson(resolve(workspaceDir, 'turbo.json'), 'turbo.json');
	const biomeConfig = readJson(resolve(workspaceDir, 'biome.json'), 'biome.json');
	const rootLint = rootManifest.scripts?.lint;
	const coverageCommand = rootManifest.scripts?.['lint:workspace-coverage'];
	validateBiomeConfig(biomeConfig);
	if (mode === 'public') {
		if (rootLint !== PUBLIC_ROOT_LINT) {
			throw new Error(
				'Public root lint must validate dynamic workspace coverage before Turbo',
			);
		}
	} else {
		if (
			coverageCommand !==
			'bun test scripts/check-workspace-lint.spec.mjs scripts/run-strict-biome.spec.mjs && bun scripts/check-workspace-lint.mjs'
		) {
			throw new Error(
				'lint:workspace-coverage must test and invoke the version-controlled coverage gate',
			);
		}
		if (rootLint !== PRIVATE_ROOT_LINT) {
			throw new Error(
				'Root lint must validate coverage, run every Turbo workspace without static filters, and finish with release-surface lint',
			);
		}
		validateStrictRunnerCommand(
			rootManifest.scripts?.['lint:repository-surfaces'],
			workspaceDir,
			'lint:repository-surfaces',
			REPOSITORY_LINT_TARGETS,
			repositoryDir,
		);
	}
	const lintInputs = turboConfig.tasks?.lint?.inputs;
	const requiredLintInputs = [
		'$TURBO_DEFAULT$',
		'$TURBO_ROOT$/biome.json',
		'$TURBO_ROOT$/scripts/run-strict-biome.mjs',
	];
	if (
		!Array.isArray(lintInputs)
		|| lintInputs.length !== requiredLintInputs.length
		|| requiredLintInputs.some((input) => !lintInputs.includes(input))
	) {
		throw new Error(
			'Turbo lint cache inputs must include package files, biome.json, and the strict runner',
		);
	}

	if (mode === 'private') {
		const hookSource = readFileSync(resolve(repositoryDir, 'lefthook.yml'), 'utf8');
		validatePrivateHookSource(hookSource);
	}
}

function validateWorkspaceScripts(workspaces) {
	for (const { name, path } of workspaces) {
		const packageDir = resolve(workspaceDir, path);
		const manifest = readJson(resolve(packageDir, 'package.json'), `${name} package.json`);
		const lint = manifest.scripts?.lint;
		validateStrictRunnerCommand(lint, packageDir, `${name} lint`, ['.']);
		for (const configName of ['biome.json', 'biome.jsonc']) {
			if (existsSync(resolve(packageDir, configName))) {
				throw new Error(
					`${name} cannot define a second ${configName} lint authority`,
				);
			}
		}
	}
}

function validatePrivateProjections() {
	const baselineDirectory = resolve(workspaceDir, 'scripts', 'baselines');
	if (
		existsSync(baselineDirectory) &&
		readdirSync(baselineDirectory).length > 0
	) {
		throw new Error('The lint baseline directory must remain empty');
	}

	const { APP_CONFIGS } = require('./sync-public.cjs');
	for (const appName of ['halo', 'spectra']) {
		const config = APP_CONFIGS?.[appName];
		if (
			!config ||
			JSON.stringify(config.publicRootFiles) !==
				'["scripts/check-workspace-lint.mjs","scripts/run-lint-parallel.mjs","scripts/run-strict-biome.mjs"]' ||
			config.publicRootScriptOverrides?.lint !== PUBLIC_ROOT_LINT
		) {
			throw new Error(
				`${appName} public sync must project the workspace coverage gate and strict runner`,
			);
		}
		validateStrictRunnerCommand(
			config.publicApplicationScriptOverrides?.lint,
			resolve(workspaceDir, config.applicationPath),
			`${appName} public application lint`,
			PUBLIC_APPLICATION_LINT_TARGETS[appName],
		);
	}

	const crossPlatformWorkflow = readFileSync(
		resolve(repositoryDir, '.github', 'workflows', 'cross-platform.yml'),
		'utf8',
	);
	if (!crossPlatformWorkflow.includes('          bun run lint')) {
		throw new Error('Cross-platform CI must run the complete repository lint owner');
	}
	const documentationWorkflow = readFileSync(
		resolve(repositoryDir, '.github', 'workflows', 'documentation.yml'),
		'utf8',
	);
	if (
		!documentationWorkflow.includes(
			'bun --cwd nexus scripts/run-strict-biome.mjs',
		) ||
		/\bbiome\s+check\b/u.test(documentationWorkflow)
	) {
		throw new Error(
			'Documentation CI must delegate its focused source checks to the strict runner',
		);
	}

	const postWriteHook = readFileSync(
		resolve(workspaceDir, 'scripts', 'hooks', 'ai-post-write-lint.mjs'),
		'utf8',
	);
	if (
		!postWriteHook.includes(
			"['scripts/run-strict-biome.mjs', ...lintTargets]",
		) ||
		/\bbiome\s+check\b/u.test(postWriteHook)
	) {
		throw new Error('AI post-write lint must delegate to the strict runner');
	}
}

function main() {
	const startedAt = performance.now();
	const mode = parseMode(process.argv.slice(2));
	validateRootCommand(mode);
	const workspaces = discoverWorkspaces();
	validateWorkspaceScripts(workspaces);
	if (mode === 'private') validatePrivateProjections();
	const elapsedMs = Math.round(performance.now() - startedAt);
	console.log(
		`✓ Workspace lint coverage: ${workspaces.length} packages (${workspaces
			.map(({ name }) => name)
			.join(', ')}) in ${elapsedMs}ms`,
	);
}

export {
	parseMode,
	portableRepoPath,
	validateBiomeConfig,
	validatePrivateHookSource,
	validateStrictRunnerCommand,
};

if (import.meta.main) {
	try {
		main();
	} catch (error) {
		console.error(`✗ Workspace lint coverage failed: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}
