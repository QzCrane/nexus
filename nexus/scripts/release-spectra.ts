import { spawnSync } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUN_VERSION } from './toolchain-versions.ts';
import { REMOTE_SITE_BASE_URL_ENV } from './check-spectra-remote-live.ts';

export const EXPECTED_BUN_VERSION = BUN_VERSION;
export const PRODUCTION_REMOTE_SITE_BASE_URL = 'https://nexus-remote.pages.dev/';

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const extensionDir = resolve(workspaceDir, 'apps/extension-spectra');
const remoteSiteDir = resolve(workspaceDir, '../remote-site');
const stagingDir = resolve(extensionDir, 'release/.staging');
const packageJson = JSON.parse(readFileSync(resolve(extensionDir, 'package.json'), 'utf8'));
const stagedArchive = resolve(stagingDir, `spectra-v${packageJson.version}.zip`);
const lockfilePath = resolve(workspaceDir, 'bun.lock');
export const RELEASE_RECEIPT_VERSION = 1;
export const RELEASE_RECEIPT_TTL_MS = 10 * 60_000;
export const RELEASE_RECEIPT_PATH_ENV = 'SPECTRA_RELEASE_RECEIPT_PATH';
export const RELEASE_RECEIPT_CAPABILITY_ENV = 'SPECTRA_RELEASE_CAPABILITY';
export const RELEASE_SOURCE_DIGEST_ENV = 'SPECTRA_RELEASE_SOURCE_SHA256';

const SOURCE_DIGEST_IGNORED_DIRECTORIES = new Set([
	'.git',
	'.turbo',
	'.cache',
	'_archive',
	'assets-backup',
	'coverage',
	'dist',
	'node_modules',
	'release',
]);

const SOURCE_DIGEST_IGNORED_FILE_SUFFIXES = Object.freeze([
	'.tsbuildinfo',
]);

export const RELEASE_STEPS = Object.freeze([
	{ label: 'architecture verify', args: ['run', 'verify:v'] },
	{ label: 'documentation architecture', args: ['run', 'docs:check'] },
	{ label: 'platform contract', args: ['run', 'check:platform'] },
	{ label: 'repository governance contracts', args: ['run', 'check:governance'] },
	{ label: 'public projection contract', args: ['run', 'check:public-projections'] },
	{ label: 'frozen dependency install', args: ['install', '--frozen-lockfile'] },
	{ label: 'toolchain verify', args: ['run', 'check:toolchain'] },
	{ label: 'Biome lint', args: ['run', 'lint'] },
	{ label: 'workspace dependency build', args: ['run', 'build:spectra-deps'] },
	{ label: 'TypeScript check', args: ['run', 'typecheck:spectra'] },
	{ label: 'unit and contract tests', args: ['run', '--cwd', 'apps/extension-spectra', 'test:unit'] },
	{ label: 'production build', args: ['run', '--cwd', 'apps/extension-spectra', 'build:prod'] },
	{ label: 'production Chrome integration', args: ['run', '--cwd', 'apps/extension-spectra', 'test:chrome:dist'] },
	{ label: 'dependency audit', args: ['run', 'audit:dependencies'] },
	{
		label: 'remote-site live deployment',
		args: [
			'scripts/check-spectra-remote-live.ts',
			'--base-url',
			PRODUCTION_REMOTE_SITE_BASE_URL,
		],
	},
	{ label: 'deterministic staging ZIP', args: ['run', '--cwd', 'apps/extension-spectra', 'package:stage'] },
	{
		label: 'extracted ZIP Chrome smoke and promotion',
		args: ['apps/extension-spectra/scripts/smoke-release.ts', '--stage', '--promote'],
		requiresReceipt: true,
	},
]);

export const RELEASE_REQUIRED_GATE_LABELS = Object.freeze(
	RELEASE_STEPS.filter((step) => !step.requiresReceipt).map((step) => step.label),
);

export function assertReleaseRuntime(version = Bun.version) {
	if (version !== EXPECTED_BUN_VERSION) {
		throw new Error(`SPECTRA release requires Bun ${EXPECTED_BUN_VERSION}, found ${version}`);
	}
}

function formatCommand(args) {
	return [process.execPath, ...args].map((part) => part.includes(' ') ? JSON.stringify(part) : part).join(' ');
}

function releaseEnvironment(receipt, frozenSourceDigest) {
	const executableDirectory = dirname(process.execPath);
	const environment = {
		...process.env,
		PATH: `${executableDirectory}${delimiter}${process.env.PATH ?? ''}`,
	};
	delete environment[RELEASE_RECEIPT_PATH_ENV];
	delete environment[RELEASE_RECEIPT_CAPABILITY_ENV];
	// The standalone checker intentionally supports staging/local overrides. A
	// release must always verify the production URL embedded in the extension.
	delete environment[REMOTE_SITE_BASE_URL_ENV];
	delete environment[RELEASE_SOURCE_DIGEST_ENV];
	if (frozenSourceDigest) environment[RELEASE_SOURCE_DIGEST_ENV] = frozenSourceDigest;
	if (receipt) {
		environment[RELEASE_RECEIPT_PATH_ENV] = receipt.receiptPath;
		environment[RELEASE_RECEIPT_CAPABILITY_ENV] = receipt.capability;
	}
	return environment;
}

export function sha256File(path) {
	return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function listReleaseSourceFiles(directory, root = directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		if (entry.isDirectory() && SOURCE_DIGEST_IGNORED_DIRECTORIES.has(entry.name)) return [];
		if (entry.isFile() && SOURCE_DIGEST_IGNORED_FILE_SUFFIXES.some((suffix) => (
			entry.name.endsWith(suffix)
		))) return [];
		const path = resolve(directory, entry.name);
		if (entry.isSymbolicLink()) throw new Error(`Release source symlinks are forbidden: ${path}`);
		if (entry.isDirectory()) return listReleaseSourceFiles(path, root);
		if (!entry.isFile()) throw new Error(`Unsupported release source file: ${path}`);
		return [{ path, name: path.slice(root.length + 1).replaceAll('\\', '/') }];
	}).sort((left, right) => left.name === right.name ? 0 : left.name < right.name ? -1 : 1);
}

export function computeReleaseSourceDigest(directories = [workspaceDir, remoteSiteDir]) {
	const roots = (Array.isArray(directories) ? directories : [directories])
		.map((directory) => resolve(directory));
	const hash = createHash('sha256');
	for (const [rootIndex, root] of roots.entries()) {
		hash.update(`root:${rootIndex}:`);
		for (const file of listReleaseSourceFiles(root)) {
			const data = readFileSync(file.path);
			hash.update(`${Buffer.byteLength(file.name, 'utf8')}:`);
			hash.update(file.name);
			hash.update(`:${data.length}:`);
			hash.update(data);
		}
	}
	return hash.digest('hex');
}

export function createReleaseReceiptDocument(facts, capability, {
	now = Date.now(),
	nonce = randomBytes(16).toString('hex'),
} = {}) {
	if (!/^[a-f0-9]{64}$/u.test(capability)) {
		throw new Error('Release receipt capability must be 256-bit hex');
	}
	const body = {
		version: RELEASE_RECEIPT_VERSION,
		nonce,
		createdAt: now,
		expiresAt: now + RELEASE_RECEIPT_TTL_MS,
		archivePath: resolve(facts.archivePath),
		archiveSha256: facts.archiveSha256,
		checksumSha256: facts.checksumSha256,
		lockfileSha256: facts.lockfileSha256,
		sourceSha256: facts.sourceSha256,
		gateResults: RELEASE_REQUIRED_GATE_LABELS.map((label) => ({ label, status: 'passed' })),
	};
	const mac = createHmac('sha256', capability).update(JSON.stringify(body)).digest('hex');
	return { body, mac };
}

function currentReleaseFacts() {
	const checksumPath = `${stagedArchive}.sha256`;
	return {
		archivePath: stagedArchive,
		archiveSha256: sha256File(stagedArchive),
		checksumSha256: sha256File(checksumPath),
		lockfileSha256: sha256File(lockfilePath),
		sourceSha256: computeReleaseSourceDigest(),
	};
}

export function createPromotionReceipt(
	completedSteps,
	now = Date.now(),
	expectedSourceDigest,
) {
	if (!Array.isArray(completedSteps)
		|| completedSteps.length !== RELEASE_REQUIRED_GATE_LABELS.length
		|| completedSteps.some((label, index) => label !== RELEASE_REQUIRED_GATE_LABELS[index])) {
		throw new Error('Cannot authorize promotion before every prior release gate succeeds');
	}
	const directory = mkdtempSync(resolve(tmpdir(), 'spectra-release-receipt-'));
	const receiptPath = resolve(directory, 'receipt.json');
	const capability = randomBytes(32).toString('hex');
	try {
		const facts = currentReleaseFacts();
		if (expectedSourceDigest && facts.sourceSha256 !== expectedSourceDigest) {
			throw new Error('Release source changed before promotion authorization; restart the complete release gate');
		}
		const receipt = createReleaseReceiptDocument(facts, capability, { now });
		writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`, { flag: 'wx', mode: 0o600 });
		return { directory, receiptPath, capability, receipt };
	} catch (error) {
		rmSync(directory, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 100,
		});
		throw error;
	}
}

export function cleanupReleaseStaging(directory = stagingDir) {
	rmSync(directory, {
		recursive: true,
		force: true,
		maxRetries: 5,
		retryDelay: 100,
	});
}

export function runRelease({
	spawnProcess = spawnSync,
	readSourceDigest = computeReleaseSourceDigest,
	cleanupStaging = cleanupReleaseStaging,
	runtimeVersion = Bun.version,
} = {}) {
	assertReleaseRuntime(runtimeVersion);
	const frozenSourceDigest = readSourceDigest();
	const completedSteps = [];
	let receipt: unknown;
	try {
		// Never let an archive from an earlier failed attempt become the input to
		// this run. The same cleanup is repeated in finally for every failure path.
		cleanupStaging();
		for (const [index, step] of RELEASE_STEPS.entries()) {
			console.log(`\n[${index + 1}/${RELEASE_STEPS.length}] ${step.label}`);
			if (step.requiresReceipt) {
				receipt = createPromotionReceipt(completedSteps, Date.now(), frozenSourceDigest);
			}
			const result = spawnProcess(process.execPath, step.args, {
				cwd: workspaceDir,
				env: releaseEnvironment(receipt, frozenSourceDigest),
				stdio: 'inherit',
				shell: false,
			});
			if (result.error) throw result.error;
			if (result.status !== 0) {
				const reason = result.signal ? `signal ${result.signal}` : `exit code ${result.status ?? 'unknown'}`;
				throw new Error(`SPECTRA release stopped at ${step.label}: ${reason}`);
			}
			const currentSourceDigest = readSourceDigest();
			if (currentSourceDigest !== frozenSourceDigest) {
				throw new Error(
					`SPECTRA release source changed during ${step.label}; restart the complete release gate`,
				);
			}
			completedSteps.push(step.label);
		}
	} finally {
		if (receipt) {
			rmSync(receipt.directory, {
				recursive: true,
				force: true,
				maxRetries: 5,
				retryDelay: 100,
			});
		}
		cleanupStaging();
	}
	console.log('\n✓ SPECTRA release candidate passed every gate and was promoted');
}

function printPlan() {
	assertReleaseRuntime();
	console.log(`SPECTRA release runtime: Bun ${Bun.version}`);
	for (const [index, step] of RELEASE_STEPS.entries()) {
		const authorization = step.requiresReceipt ? ' [one-time receipt issued after prior gates]' : '';
		console.log(`${index + 1}. ${step.label}${authorization}: ${formatCommand(step.args)}`);
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	if (args.length === 0) runRelease();
	else if (args.length === 1 && (args[0] === '--list' || args[0] === '--help' || args[0] === '-h')) printPlan();
	else throw new Error(`Unknown release-spectra option: ${args.join(', ')}`);
}
