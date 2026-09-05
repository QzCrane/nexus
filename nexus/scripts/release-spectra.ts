import { spawnSync } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUN_VERSION } from './toolchain-versions.ts';
import { REMOTE_SITE_BASE_URL_ENV } from './check-spectra-remote-live.ts';
import { analyzeProductionArtifacts } from '../apps/extension-spectra/scripts/check-production-artifacts.ts';

export const EXPECTED_BUN_VERSION = BUN_VERSION;
export const PRODUCTION_REMOTE_SITE_BASE_URL = 'https://nexus-remote.pages.dev/';

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const extensionDir = resolve(workspaceDir, 'apps/extension-spectra');
const stagingDir = resolve(extensionDir, 'release/.staging');
const packageJson = JSON.parse(readFileSync(resolve(extensionDir, 'package.json'), 'utf8'));
const stagedArchive = resolve(stagingDir, `spectra-v${packageJson.version}.zip`);
const lockfilePath = resolve(workspaceDir, 'bun.lock');
export const RELEASE_RECEIPT_VERSION = 2;
export const RELEASE_RECEIPT_TTL_MS = 10 * 60_000;
export const RELEASE_RECEIPT_PATH_ENV = 'SPECTRA_RELEASE_RECEIPT_PATH';
export const RELEASE_RECEIPT_CAPABILITY_ENV = 'SPECTRA_RELEASE_CAPABILITY';
export const RELEASE_SOURCE_DIGEST_ENV = 'SPECTRA_RELEASE_SOURCE_SHA256';
export const RELEASE_COMMIT_OID_ENV = 'SPECTRA_RELEASE_COMMIT_OID';
export const RELEASE_TREE_OID_ENV = 'SPECTRA_RELEASE_TREE_OID';
export const RELEASE_CANDIDATE_RECEIPT_PATH_ENV = 'SPECTRA_RELEASE_CANDIDATE_RECEIPT_PATH';
export const RELEASE_CANDIDATE_RECEIPT_CAPABILITY_ENV = 'SPECTRA_RELEASE_CANDIDATE_CAPABILITY';
export const CANDIDATE_RECEIPT_VERSION = 1;
export const CANDIDATE_RECEIPT_TTL_MS = 30 * 60_000;

const repositoryDir = resolve(workspaceDir, '..');

/**
 * The release input is the transitive SPECTRA build/runtime/tooling closure,
 * not the whole monorepo. Keep this list as the single owner for both the
 * clean-tree gate and the source digest so unrelated HALO/UI-kit work cannot
 * invalidate a SPECTRA candidate (while a shared contract or release gate
 * change still does).
 */
export const SPECTRA_RELEASE_PATHS = Object.freeze([
	'package.json',
	'commitlint.config.cjs',
	'.codex/hooks.json',
	'nexus/apps/extension-spectra',
	'nexus/packages/contracts',
	'nexus/packages/nexus-kernel',
	'nexus/packages/features/audio-engine',
	'nexus/package.json',
	'nexus/bun.lock',
	'nexus/biome.json',
	'nexus/tsconfig.base.json',
	'nexus/turbo.json',
	'nexus/closeout-policy.json',
	'nexus/scripts/release-spectra.ts',
	'nexus/scripts/check-public-projections.ts',
	'nexus/scripts/spectra-public-projections.ts',
	'nexus/scripts/check-spectra-remote-live.ts',
	'nexus/scripts/check-toolchain.ts',
	'nexus/scripts/toolchain-versions.ts',
	'nexus/scripts/dependency-audit.ts',
	'nexus/scripts/run-lint-parallel.ts',
	'nexus/scripts/run-prebuild-parallel.ts',
	'nexus/scripts/run-strict-biome.ts',
	'nexus/scripts/lint-docs.ts',
	'nexus/scripts/permission-capabilities.ts',
	'nexus/scripts/check-workspace-lint.ts',
	'nexus/scripts/check-workspace-lint.spec.ts',
	'nexus/scripts/run-strict-biome.spec.ts',
	'nexus/scripts/check-platform-contract.ts',
	'nexus/scripts/platform-contract.ts',
	'nexus/scripts/platform-contract.test.ts',
	'nexus/scripts/permission-governance.spec.ts',
	'nexus/scripts/closeout-governance.spec.ts',
	'nexus/scripts/dependency-audit.spec.ts',
	'nexus/scripts/generate-tool-registry.ts',
	'nexus/scripts/registry-gen',
	'nexus/scripts/verify-architecture.ts',
	'nexus/scripts/verify',
	'remote-site',
]);

const SPECTRA_RELEASE_SOURCE_ROOTS = Object.freeze(
	SPECTRA_RELEASE_PATHS.map((path) => resolve(repositoryDir, path)),
);

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

function releaseEnvironment(receipt, frozenSourceDigest, candidateReceipt, frozenTreeIdentity) {
	const executableDirectory = dirname(process.execPath);
	const environment = {
		...process.env,
		PATH: `${executableDirectory}${delimiter}${process.env.PATH ?? ''}`,
	};
	delete environment[RELEASE_RECEIPT_PATH_ENV];
	delete environment[RELEASE_RECEIPT_CAPABILITY_ENV];
	delete environment[RELEASE_CANDIDATE_RECEIPT_PATH_ENV];
	delete environment[RELEASE_CANDIDATE_RECEIPT_CAPABILITY_ENV];
	delete environment[RELEASE_COMMIT_OID_ENV];
	delete environment[RELEASE_TREE_OID_ENV];
	// The standalone checker intentionally supports staging/local overrides. A
	// release must always verify the production URL embedded in the extension.
	delete environment[REMOTE_SITE_BASE_URL_ENV];
	delete environment[RELEASE_SOURCE_DIGEST_ENV];
	if (frozenSourceDigest) environment[RELEASE_SOURCE_DIGEST_ENV] = frozenSourceDigest;
	if (frozenTreeIdentity) {
		environment[RELEASE_COMMIT_OID_ENV] = frozenTreeIdentity.commitOid;
		environment[RELEASE_TREE_OID_ENV] = frozenTreeIdentity.treeOid;
	}
	if (receipt) {
		environment[RELEASE_RECEIPT_PATH_ENV] = receipt.receiptPath;
		environment[RELEASE_RECEIPT_CAPABILITY_ENV] = receipt.capability;
	}
	if (candidateReceipt) {
		environment[RELEASE_CANDIDATE_RECEIPT_PATH_ENV] = candidateReceipt.receiptPath;
		environment[RELEASE_CANDIDATE_RECEIPT_CAPABILITY_ENV] = candidateReceipt.capability;
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

export function computeReleaseSourceDigest(directories) {
	const roots = directories === undefined
		? [...SPECTRA_RELEASE_SOURCE_ROOTS]
		: (Array.isArray(directories) ? directories : [directories]).map((directory) => resolve(directory));
	const hash = createHash('sha256');
	for (const [rootIndex, root] of roots.entries()) {
		if (!existsSync(root)) throw new Error(`SPECTRA release source path is missing: ${root}`);
		hash.update(`root:${rootIndex}:`);
		const sourceFiles = statSync(root).isDirectory()
			? listReleaseSourceFiles(root)
			: [{ path: root, name: relative(repositoryDir, root).replaceAll('\\', '/') }];
		for (const file of sourceFiles) {
			const data = readFileSync(file.path);
			hash.update(`${Buffer.byteLength(file.name, 'utf8')}:`);
			hash.update(file.name);
			hash.update(`:${data.length}:`);
			hash.update(data);
		}
	}
	return hash.digest('hex');
}

export interface ReleaseTreeIdentity {
	commitOid: string;
	treeOid: string;
	sourceSha256: string;
}

function gitOutput(args: string[]): string {
	const result = spawnSync('git', args, {
		cwd: repositoryDir,
		encoding: 'utf8',
		shell: false,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`Git ${args[0] ?? 'command'} failed: ${String(result.stderr ?? '').trim()}`);
	}
	return String(result.stdout ?? '').trim();
}

/**
 * Freeze the release input to a clean Git tree. The SPECTRA release source
 * includes the extension, its workspace dependencies, release tooling, the
 * lockfile, and the checked-in Remote site. The ignored dist/release folders
 * are deliberately not part of this preflight; they are derived outputs.
 */
export function readReleaseTreeIdentity({
	runGit = gitOutput,
	readDigest = computeReleaseSourceDigest,
} = {}) {
	const status = runGit([
		'status',
		'--porcelain=v1',
		'--untracked-files=all',
		'--',
		...SPECTRA_RELEASE_PATHS,
	]);
	if (status.length > 0) {
		throw new Error(`SPECTRA release requires a clean exact tree; dirty paths:\n${status}`);
	}
	const commitOid = runGit(['rev-parse', 'HEAD']);
	const treeOid = runGit(['rev-parse', 'HEAD^{tree}']);
	if (!/^[a-f0-9]{40,64}$/u.test(commitOid) || !/^[a-f0-9]{40,64}$/u.test(treeOid)) {
		throw new Error('SPECTRA release Git identity is malformed');
	}
	return { commitOid, treeOid, sourceSha256: readDigest() };
}

export function assertReleaseTreeUnchanged(expected: ReleaseTreeIdentity): ReleaseTreeIdentity {
	const current = readReleaseTreeIdentity();
	if (current.commitOid !== expected.commitOid
		|| current.treeOid !== expected.treeOid
		|| current.sourceSha256 !== expected.sourceSha256) {
		throw new Error('SPECTRA release exact tree changed; restart the complete release gate');
	}
	return current;
}

function computeDirectoryDigest(directory: string): string {
	const root = resolve(directory);
	if (!existsSync(root) || !statSync(root).isDirectory()) {
		throw new Error(`SPECTRA production dist is missing: ${root}`);
	}
	const files: Array<{ path: string; name: string }> = [];
	const visit = (current: string): void => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const path = resolve(current, entry.name);
			if (entry.isSymbolicLink()) throw new Error(`Production dist symlink is forbidden: ${path}`);
			if (entry.isDirectory()) {
				visit(path);
				continue;
			}
			if (!entry.isFile()) throw new Error(`Unsupported production dist entry: ${path}`);
			files.push({ path, name: relative(root, path).replaceAll('\\', '/') });
		}
	};
	visit(root);
	files.sort((left, right) => left.name.localeCompare(right.name));
	const hash = createHash('sha256');
	for (const file of files) {
		const data = readFileSync(file.path);
		hash.update(`${Buffer.byteLength(file.name, 'utf8')}:`);
		hash.update(file.name);
		hash.update(`:${data.length}:`);
		hash.update(data);
	}
	return hash.digest('hex');
}

export interface CandidateReceiptFacts extends ReleaseTreeIdentity {
	packageVersion: string;
	lockfileSha256: string;
	distSha256: string;
	distManifestSha256: string;
}

export function currentCandidateFacts(
	identity = readReleaseTreeIdentity(),
	distDir = resolve(extensionDir, 'dist'),
): CandidateReceiptFacts {
	const manifestPath = resolve(distDir, 'manifest.json');
	const popupPath = resolve(distDir, 'popup.html');
	if (!existsSync(manifestPath) || !existsSync(popupPath)) {
		throw new Error('SPECTRA production dist is missing manifest.json or popup.html');
	}
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
		manifest_version?: unknown;
		version?: unknown;
	};
	if (manifest.manifest_version !== 3 || manifest.version !== packageJson.version) {
		throw new Error(`SPECTRA candidate manifest must be MV3 version ${packageJson.version}`);
	}
	if (!readFileSync(popupPath, 'utf8').includes(`v${packageJson.version} • Prod`)) {
		throw new Error('SPECTRA candidate dist is not a verified production build');
	}
	const artifactReport = analyzeProductionArtifacts({ distDir });
	if (artifactReport.failures.length > 0) {
		throw new Error(`SPECTRA candidate artifact integrity failed:\n${artifactReport.failures.join('\n')}`);
	}
	return {
		...identity,
		packageVersion: packageJson.version,
		lockfileSha256: sha256File(lockfilePath),
		distSha256: computeDirectoryDigest(distDir),
		distManifestSha256: sha256File(manifestPath),
	};
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const keys = Object.keys(value);
	return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function assertCandidateReceiptPath(receiptPath: string): string {
	const normalized = resolve(receiptPath);
	const relativeReceipt = relative(resolve(tmpdir()), normalized).replaceAll('\\', '/');
	if (!relativeReceipt || relativeReceipt.startsWith('..') || relativeReceipt.includes('/') === false
		|| !/^spectra-candidate-receipt-[^/]+\/receipt\.json$/u.test(relativeReceipt)) {
		throw new Error('Candidate receipt path is invalid');
	}
	return normalized;
}

export function createCandidateReceiptDocument(facts: CandidateReceiptFacts, capability: string, {
	now = Date.now(),
	nonce = randomBytes(16).toString('hex'),
} = {}) {
	if (!/^[a-f0-9]{64}$/u.test(capability)) throw new Error('Candidate receipt capability must be 256-bit hex');
	if (!/^[a-f0-9]{40,64}$/u.test(facts.commitOid)
		|| !/^[a-f0-9]{40,64}$/u.test(facts.treeOid)
		|| !/^[a-f0-9]{64}$/u.test(facts.sourceSha256)
		|| !/^[a-f0-9]{64}$/u.test(facts.lockfileSha256)
		|| !/^[a-f0-9]{64}$/u.test(facts.distSha256)
		|| !/^[a-f0-9]{64}$/u.test(facts.distManifestSha256)) {
		throw new Error('Candidate receipt facts are malformed');
	}
	const body = {
		version: CANDIDATE_RECEIPT_VERSION,
		nonce,
		createdAt: now,
		expiresAt: now + CANDIDATE_RECEIPT_TTL_MS,
		commitOid: facts.commitOid,
		treeOid: facts.treeOid,
		sourceSha256: facts.sourceSha256,
		packageVersion: facts.packageVersion,
		lockfileSha256: facts.lockfileSha256,
		distSha256: facts.distSha256,
		distManifestSha256: facts.distManifestSha256,
		buildProfile: 'production',
	};
	const mac = createHmac('sha256', capability).update(JSON.stringify(body)).digest('hex');
	return { body, mac };
}

export function createCandidateReceipt({
	distDir = resolve(extensionDir, 'dist'),
	identity = readReleaseTreeIdentity(),
	now = Date.now(),
} = {}) {
	const facts = currentCandidateFacts(identity, distDir);
	const capability = randomBytes(32).toString('hex');
	const directory = mkdtempSync(resolve(tmpdir(), 'spectra-candidate-receipt-'));
	const receiptPath = resolve(directory, 'receipt.json');
	try {
		const receipt = createCandidateReceiptDocument(facts, capability, { now });
		writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`, { flag: 'wx', mode: 0o600 });
		return { directory, receiptPath, capability, facts, receipt };
	} catch (error) {
		rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
		throw error;
	}
}

export function validateCandidateReceipt({
	receiptPath,
	capability,
	expectedFacts,
	now = Date.now(),
}: {
	receiptPath: string;
	capability: string;
	expectedFacts: CandidateReceiptFacts;
	now?: number;
}) {
	const path = assertCandidateReceiptPath(receiptPath);
	if (!existsSync(path) || statSync(path).size > 16 * 1024) throw new Error('Candidate receipt is missing or oversized');
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, 'utf8'));
	} catch {
		throw new Error('Candidate receipt is malformed');
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Candidate receipt is malformed');
	const document = parsed as { body?: unknown; mac?: unknown };
	if (!document.body || typeof document.body !== 'object' || Array.isArray(document.body)
		|| typeof document.mac !== 'string') throw new Error('Candidate receipt is malformed');
	const body = document.body as Record<string, unknown>;
	const keys = [
		'version', 'nonce', 'createdAt', 'expiresAt', 'commitOid', 'treeOid', 'sourceSha256',
		'packageVersion', 'lockfileSha256', 'distSha256', 'distManifestSha256', 'buildProfile',
	] as const;
	if (!hasExactKeys(body, keys) || !/^[a-f0-9]{64}$/u.test(document.mac)) {
		throw new Error('Candidate receipt is malformed');
	}
	const factsValid = body.commitOid === expectedFacts.commitOid
		&& body.treeOid === expectedFacts.treeOid
		&& body.sourceSha256 === expectedFacts.sourceSha256
		&& body.packageVersion === expectedFacts.packageVersion
		&& body.lockfileSha256 === expectedFacts.lockfileSha256
		&& body.distSha256 === expectedFacts.distSha256
		&& body.distManifestSha256 === expectedFacts.distManifestSha256;
	if (body.version !== CANDIDATE_RECEIPT_VERSION
		|| !/^[a-f0-9]{32}$/u.test(String(body.nonce))
		|| !Number.isSafeInteger(body.createdAt)
		|| !Number.isSafeInteger(body.expiresAt)
		|| body.createdAt > now + 5_000
		|| body.expiresAt < now
		|| body.expiresAt - body.createdAt !== CANDIDATE_RECEIPT_TTL_MS
		|| body.buildProfile !== 'production'
		|| !factsValid) {
		throw new Error('Candidate receipt is stale, incomplete, or bound to different inputs');
	}
	const expectedMac = createHmac('sha256', capability).update(JSON.stringify(body)).digest('hex');
	if (document.mac !== expectedMac) throw new Error('Candidate receipt authentication failed');
	return parsed;
}

export function createReleaseReceiptDocument(facts, capability, {
	now = Date.now(),
	nonce = randomBytes(16).toString('hex'),
} = {}) {
	if (!/^[a-f0-9]{64}$/u.test(capability)) {
		throw new Error('Release receipt capability must be 256-bit hex');
	}
	if (!/^[a-f0-9]{40,64}$/u.test(facts.commitOid)
		|| !/^[a-f0-9]{40,64}$/u.test(facts.treeOid)
		|| !/^[a-f0-9]{64}$/u.test(facts.sourceSha256)
		|| !/^[a-f0-9]{64}$/u.test(facts.lockfileSha256)) {
		throw new Error('Release receipt facts are malformed');
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
		commitOid: facts.commitOid,
		treeOid: facts.treeOid,
		sourceSha256: facts.sourceSha256,
		gateResults: RELEASE_REQUIRED_GATE_LABELS.map((label) => ({ label, status: 'passed' })),
	};
	const mac = createHmac('sha256', capability).update(JSON.stringify(body)).digest('hex');
	return { body, mac };
}

function currentReleaseFacts() {
	const checksumPath = `${stagedArchive}.sha256`;
	const identity = readReleaseTreeIdentity();
	return {
		archivePath: stagedArchive,
		archiveSha256: sha256File(stagedArchive),
		checksumSha256: sha256File(checksumPath),
		lockfileSha256: sha256File(lockfilePath),
		commitOid: identity.commitOid,
		treeOid: identity.treeOid,
		sourceSha256: identity.sourceSha256,
	};
}

export function createPromotionReceipt(
	completedSteps,
	now = Date.now(),
	expectedSourceDigest,
	candidateReceipt,
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
		if (candidateReceipt) {
			const candidateFacts = currentCandidateFacts(
				{
					commitOid: facts.commitOid,
					treeOid: facts.treeOid,
					sourceSha256: facts.sourceSha256,
				},
			);
			validateCandidateReceipt({
				receiptPath: candidateReceipt.receiptPath,
				capability: candidateReceipt.capability,
				expectedFacts: candidateFacts,
				now,
			});
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
	readTreeIdentity = readReleaseTreeIdentity,
	createCandidate = ({ identity }) => createCandidateReceipt({ identity }),
	cleanupStaging = cleanupReleaseStaging,
	runtimeVersion = Bun.version,
} = {}) {
	assertReleaseRuntime(runtimeVersion);
	const frozenTreeIdentity = readTreeIdentity();
	const frozenSourceDigest = readSourceDigest();
	if (frozenTreeIdentity.sourceSha256 !== frozenSourceDigest) {
		throw new Error('SPECTRA release source identity digest is inconsistent; restart the complete release gate');
	}
	const completedSteps = [];
	let receipt: unknown;
	let candidateReceipt: ReturnType<typeof createCandidateReceipt> | undefined;
	try {
		// Never let an archive from an earlier failed attempt become the input to
		// this run. The same cleanup is repeated in finally for every failure path.
		cleanupStaging();
		for (const [index, step] of RELEASE_STEPS.entries()) {
			console.log(`\n[${index + 1}/${RELEASE_STEPS.length}] ${step.label}`);
			if (step.requiresReceipt) {
				receipt = createPromotionReceipt(
					completedSteps,
					Date.now(),
					frozenSourceDigest,
					candidateReceipt,
				);
			}
			if (step.label === 'production Chrome integration' && !candidateReceipt) {
				candidateReceipt = createCandidate({ identity: frozenTreeIdentity });
			}
			const result = spawnProcess(process.execPath, step.args, {
				cwd: workspaceDir,
				env: releaseEnvironment(receipt, frozenSourceDigest, candidateReceipt, frozenTreeIdentity),
				stdio: 'inherit',
				shell: false,
			});
			if (result.error) throw result.error;
			if (result.status !== 0) {
				const reason = result.signal ? `signal ${result.signal}` : `exit code ${result.status ?? 'unknown'}`;
				throw new Error(`SPECTRA release stopped at ${step.label}: ${reason}`);
			}
			const currentTreeIdentity = readTreeIdentity();
			const currentSourceDigest = readSourceDigest();
			if (currentTreeIdentity.commitOid !== frozenTreeIdentity.commitOid
				|| currentTreeIdentity.treeOid !== frozenTreeIdentity.treeOid
				|| currentTreeIdentity.sourceSha256 !== frozenTreeIdentity.sourceSha256
				|| currentSourceDigest !== frozenSourceDigest) {
				throw new Error(
					`SPECTRA release exact tree changed during ${step.label}; restart the complete release gate`,
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
		if (candidateReceipt) {
			rmSync(candidateReceipt.directory, {
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
