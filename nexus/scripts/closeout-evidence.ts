// goal: bind two complete local product releases to one exact PR head and merge tree
// inv: hosted infrastructure is reported separately; merge and cleanup are exact-SHA CAS operations

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	statSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { arch, release as osRelease, tmpdir } from 'node:os';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CloseoutPolicy {
	schemaVersion: 1;
	requiredAttempts: number;
	targetBranch: string;
	hostedRequired: boolean;
	allowedHostedStatuses: string[];
	lanes: Array<{ label: string; args: string[] }>;
	products: Record<string, { versionFile: string; artifact: string }>;
	toolFiles: string[];
	platform: { image: string; environment: Record<string, string>; lanes: string[][] };
}

interface ArtifactEvidence {
	path: string;
	sha256: string;
	bytes: number;
}

interface CloseoutReceiptBody {
	schemaVersion: 1;
	attempt: number;
	recordedAt: string;
	head: string;
	tree: string;
	base: string;
	versions: Record<string, string>;
	lanes: Array<{ label: string; args: string[]; status: 'PASS'; durationMs: number }>;
	artifacts: Record<string, ArtifactEvidence>;
	toolSha256: Record<string, string>;
	host: Record<string, unknown>;
	hosted: { status: string; detail: string };
	platform: PlatformEvidence;
}

export interface CloseoutReceipt extends CloseoutReceiptBody {
	receiptSha256: string;
}

export interface PlatformEvidence {
	schemaVersion: 1;
	recordedAt: string;
	head: string;
	tree: string;
	image: string;
	imageIdentity: string;
	environment: Record<string, string>;
	platform: 'linux';
	lanes: Array<{ args: string[]; status: 'PASS' }>;
	toolSha256: Record<string, string>;
	evidenceSha256: string;
}

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryDir = dirname(workspaceDir);
const artifactsDir = resolve(workspaceDir, 'artifacts');
const policyPath = resolve(workspaceDir, 'closeout-policy.json');
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const GITHUB_READ_ATTEMPTS = 6;
const GIT_REMOTE_READ_ATTEMPTS = 6;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface GitHubReadOptions {
	token?: string;
	fetchImpl?: FetchLike;
	attempts?: number;
	sleep?: (milliseconds: number) => Promise<void>;
}

let cachedGitHubToken: string | undefined;

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}

export function sha256Bytes(value: string | Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}

export function receiptDigest(body: CloseoutReceiptBody): string {
	return sha256Bytes(canonical(body));
}

function platformEvidencePath(head: string): string {
	return resolve(artifactsDir, `closeout-platform-linux.${head}.json`);
}

function closeoutReceiptPath(head: string, attempt: number): string {
	return resolve(artifactsDir, `closeout-evidence.${head}.attempt-${attempt}.json`);
}

export function writeImmutableEvidenceFile(path: string, content: string): 'created' | 'existing' {
	try {
		writeFileSync(path, content, { encoding: 'utf8', flag: 'wx' });
		return 'created';
	} catch (error: unknown) {
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
		if (readFileSync(path, 'utf8') === content) return 'existing';
		throw new Error(`immutable closeout evidence already exists with different content: ${relative(workspaceDir, path)}`);
	}
}

function readPolicy(): CloseoutPolicy {
	const policy = JSON.parse(readFileSync(policyPath, 'utf8')) as CloseoutPolicy;
	if (policy.schemaVersion !== 1 || policy.requiredAttempts !== 2
		|| policy.targetBranch !== 'main' || policy.hostedRequired !== false
		|| policy.lanes.length !== 2 || Object.keys(policy.products).length !== 2
		|| !/^oven\/bun:1\.3\.14@sha256:[a-f0-9]{64}$/u.test(policy.platform?.image ?? '')
		|| policy.platform.environment?.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD !== '1'
		|| policy.platform.environment?.PUPPETEER_SKIP_DOWNLOAD !== 'true'
		|| Object.keys(policy.platform.environment).length !== 2
		|| policy.platform.lanes.length === 0) {
		throw new Error('closeout-policy.json does not satisfy the repository closeout contract');
	}
	return policy;
}

function run(
	command: string,
	args: string[],
	options: { inherit?: boolean; allowFailure?: boolean; timeoutMs?: number } = {},
): { status: number; stdout: string; stderr: string } {
	const result = spawnSync(command, args, {
		cwd: workspaceDir,
		encoding: 'utf8',
		stdio: options.inherit ? 'inherit' : 'pipe',
		timeout: options.timeoutMs,
		shell: false,
	});
	if (result.error) throw result.error;
	const status = result.status ?? 1;
	if (status !== 0 && !options.allowFailure) {
		throw new Error(`${command} ${args.join(' ')} failed (${status}): ${result.stderr ?? ''}`);
	}
	return {
		status,
		stdout: options.inherit ? '' : String(result.stdout ?? '').trim(),
		stderr: options.inherit ? '' : String(result.stderr ?? '').trim(),
	};
}

function git(...args: string[]): string {
	return run('git', args).stdout;
}

export function parseGitHubRepository(remoteUrl: string): string {
	const normalized = remoteUrl.trim().replace(/\.git$/u, '');
	const match = normalized.match(
		/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/u,
	);
	if (!match) throw new Error(`origin is not a canonical GitHub repository URL: ${remoteUrl}`);
	return `${match[1]}/${match[2]}`;
}

function githubToken(): string {
	if (cachedGitHubToken) return cachedGitHubToken;
	const result = run('gh', ['auth', 'token'], { timeoutMs: 30_000 });
	if (!result.stdout) throw new Error('GitHub authentication token is unavailable');
	cachedGitHubToken = result.stdout;
	return cachedGitHubToken;
}

export function parseRemoteRef(output: string, expectedRef: string): string | undefined {
	if (!expectedRef.startsWith('refs/heads/')) throw new Error(`remote ref is not a branch: ${expectedRef}`);
	const trimmed = output.trim();
	if (!trimmed) return undefined;
	const lines = trimmed.split(/\r?\n/u);
	if (lines.length !== 1) throw new Error(`remote ref read was ambiguous: ${output}`);
	const fields = lines[0]?.trim().split(/\s+/u) ?? [];
	if (fields.length !== 2 || fields[1] !== expectedRef || !SHA_PATTERN.test(fields[0] ?? '')) {
		throw new Error(`remote ref read was malformed for ${expectedRef}: ${output}`);
	}
	return fields[0];
}

function gitRemoteRead(...args: string[]): string {
	let lastError = 'unknown failure';
	for (let attempt = 1; attempt <= GIT_REMOTE_READ_ATTEMPTS; attempt += 1) {
		try {
			const result = run('git', args, { allowFailure: true, timeoutMs: 60_000 });
			if (result.status === 0) return result.stdout;
			lastError = result.stderr || `exit ${result.status}`;
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
		}
		if (attempt < GIT_REMOTE_READ_ATTEMPTS) Bun.sleepSync(Math.min(1_000 * 2 ** (attempt - 1), 8_000));
	}
	throw new Error(`Git remote read failed after ${GIT_REMOTE_READ_ATTEMPTS} attempts: git ${args.join(' ')}: ${lastError}`);
}

function remoteRef(refName: string): string | undefined {
	return parseRemoteRef(gitRemoteRead('ls-remote', 'origin', refName), refName);
}

export async function githubReadJson<T>(
	path: string,
	options: GitHubReadOptions = {},
): Promise<T> {
	if (!path.startsWith('/') || path.startsWith('//')) {
		throw new Error(`GitHub REST path must be repository-relative: ${path}`);
	}
	const url = new URL(path, 'https://api.github.com');
	if (url.origin !== 'https://api.github.com') throw new Error('GitHub REST origin is not allowed');
	const attempts = options.attempts ?? GITHUB_READ_ATTEMPTS;
	if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) {
		throw new Error('GitHub REST attempts must be an integer from 1 through 10');
	}
	const fetchImpl = options.fetchImpl ?? fetch;
	const sleep = options.sleep ?? ((milliseconds: number) => Bun.sleep(milliseconds));
	const token = options.token ?? githubToken();
	let lastError = 'unknown failure';
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			const response = await fetchImpl(url, {
				headers: {
					Accept: 'application/vnd.github+json',
					Authorization: `Bearer ${token}`,
					'User-Agent': 'nexus-closeout-evidence',
					'X-GitHub-Api-Version': '2022-11-28',
				},
				signal: AbortSignal.timeout(45_000),
			});
			const responseText = await response.text();
			if (response.ok) {
				try {
					return JSON.parse(responseText) as T;
				} catch (error) {
					lastError = `invalid JSON: ${error instanceof Error ? error.message : String(error)}`;
				}
			} else {
				const detail = responseText.slice(0, 500).replaceAll(/\s+/gu, ' ').trim();
				lastError = `HTTP ${response.status}${detail ? `: ${detail}` : ''}`;
				if (![408, 429, 500, 502, 503, 504].includes(response.status)) {
					throw new Error(`GitHub REST read failed without retry: ${path}: ${lastError}`);
				}
			}
		} catch (error) {
			if (error instanceof Error && error.message.startsWith('GitHub REST read failed without retry:')) {
				throw error;
			}
			lastError = error instanceof Error ? error.message : String(error);
		}
		if (attempt < attempts) await sleep(Math.min(500 * 2 ** (attempt - 1), 4_000));
	}
	throw new Error(`GitHub REST read failed after ${attempts} attempts: ${path}: ${lastError}`);
}

function valueAfter(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

function assertCleanExactHead(expectedHead?: string): { head: string; tree: string } {
	const status = git('status', '--porcelain', '--untracked-files=normal');
	if (status) throw new Error(`closeout requires a clean candidate; found:\n${status}`);
	const head = git('rev-parse', 'HEAD');
	const tree = git('rev-parse', 'HEAD^{tree}');
	if (!SHA_PATTERN.test(head) || !SHA_PATTERN.test(tree)) throw new Error('invalid Git head/tree identity');
	if (expectedHead && head !== expectedHead) throw new Error(`expected head ${expectedHead}, found ${head}`);
	return { head, tree };
}

function remoteMain(): string {
	const sha = remoteRef('refs/heads/main');
	if (!sha) throw new Error('remote main does not exist');
	return sha;
}

function fileSha256(path: string): string {
	return sha256Bytes(readFileSync(path));
}

function toolHashes(policy: CloseoutPolicy): Record<string, string> {
	return Object.fromEntries(policy.toolFiles.map((file) => {
		const path = resolve(workspaceDir, file);
		if (!existsSync(path)) throw new Error(`closeout tool input is missing: ${file}`);
		return [file, fileSha256(path)];
	}));
}

function versions(policy: CloseoutPolicy): Record<string, string> {
	return Object.fromEntries(Object.entries(policy.products).map(([product, config]) => {
		const value = (JSON.parse(readFileSync(resolve(workspaceDir, config.versionFile), 'utf8')) as { version?: unknown }).version;
		if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/u.test(value)) {
			throw new Error(`${product} release version is invalid: ${String(value)}`);
		}
		return [product, value];
	}));
}

function artifactEvidence(
	policy: CloseoutPolicy,
	releaseVersions: Record<string, string>,
): Record<string, ArtifactEvidence> {
	return Object.fromEntries(Object.entries(policy.products).map(([product, config]) => {
		const version = releaseVersions[product];
		if (!version) throw new Error(`missing ${product} release version`);
		const relativePath = config.artifact.replace('{version}', version);
		const path = resolve(workspaceDir, relativePath);
		if (!existsSync(path)) throw new Error(`${product} release artifact is missing: ${relativePath}`);
		return [product, {
			path: relativePath.replaceAll('\\', '/'),
			sha256: fileSha256(path),
			bytes: statSync(path).size,
		}];
	}));
}

interface BrowserOwner {
	executablePath(): string | Promise<string>;
}

async function inspectBrowser(owner: string, browserOwner: BrowserOwner): Promise<Record<string, unknown>> {
	const path = await browserOwner.executablePath();
	if (!existsSync(path)) throw new Error(`${owner} browser executable is missing`);
	const version = process.platform === 'win32'
		? run('powershell.exe', [
			'-NoProfile', '-NonInteractive', '-Command',
			`(Get-Item -LiteralPath '${path.replaceAll("'", "''")}').VersionInfo.ProductVersion`,
		], { timeoutMs: 10_000 }).stdout
		: run(path, ['--version'], { timeoutMs: 10_000 }).stdout;
	if (!version.trim()) throw new Error(`${owner} browser version is empty`);
	return {
		executable: basename(path),
		version,
		bytes: statSync(path).size,
		sha256: fileSha256(path),
	};
}

function platformEvidenceDigest(body: Omit<PlatformEvidence, 'evidenceSha256'>): string {
	return sha256Bytes(canonical(body));
}

export function assertDockerImageIdentity(image: string, identity: string): void {
	const expectedDigest = image.split('@')[1];
	if (!/^sha256:[a-f0-9]{64}$/u.test(expectedDigest ?? '')) {
		throw new Error(`Docker image is not pinned by digest: ${image}`);
	}
	if (!identity.trim() || !identity.includes(expectedDigest)) {
		throw new Error(`Docker image identity does not contain ${expectedDigest}: ${identity}`);
	}
}

function ensureDockerImage(image: string): string {
	const inspectArgs = [
		'image', 'inspect', image,
		'--format', '{{.Id}} {{join .RepoDigests ","}}',
	];
	let inspection = run('docker', inspectArgs, { allowFailure: true });
	for (let attempt = 1; inspection.status !== 0 && attempt <= 3; attempt += 1) {
		const pull = run('docker', ['pull', image], { inherit: true, allowFailure: true });
		if (pull.status !== 0 && attempt === 3) {
			throw new Error(`Docker could not obtain exact image ${image} after ${attempt} attempts`);
		}
		inspection = run('docker', inspectArgs, { allowFailure: true });
	}
	if (inspection.status !== 0) throw new Error(`Docker image is unavailable: ${image}`);
	assertDockerImageIdentity(image, inspection.stdout);
	return inspection.stdout;
}

function readPlatformEvidence(
	policy: CloseoutPolicy,
	identity: { head: string; tree: string },
): PlatformEvidence {
	const path = platformEvidencePath(identity.head);
	if (!existsSync(path)) {
		throw new Error('Linux platform evidence is missing; run closeout-evidence.ts platform-record');
	}
	const evidence = JSON.parse(readFileSync(path, 'utf8')) as PlatformEvidence;
	const { evidenceSha256, ...body } = evidence;
	if (platformEvidenceDigest(body) !== evidenceSha256) throw new Error('Linux platform evidence digest mismatch');
	if (evidence.schemaVersion !== 1 || evidence.platform !== 'linux'
		|| evidence.head !== identity.head || evidence.tree !== identity.tree
		|| evidence.image !== policy.platform.image
		|| canonical(evidence.environment) !== canonical(policy.platform.environment)) {
		throw new Error('Linux platform evidence is not bound to the exact candidate');
	}
	if (evidence.lanes.length !== policy.platform.lanes.length
		|| evidence.lanes.some((lane, index) => (
			lane.status !== 'PASS' || canonical(lane.args) !== canonical(policy.platform.lanes[index])
		))) throw new Error('Linux platform evidence has incomplete lanes');
	equalCanonical(evidence.toolSha256, toolHashes(policy), 'Linux platform tool identity');
	return evidence;
}

async function platformRecord(): Promise<void> {
	const policy = readPolicy();
	const identity = assertCleanExactHead();
	const output = platformEvidencePath(identity.head);
	if (existsSync(output)) {
		const evidence = readPlatformEvidence(policy, identity);
		console.log(`closeout-platform: PASS existing head=${identity.head} evidence=${evidence.evidenceSha256}`);
		return;
	}
	const temporary = mkdtempSync(resolve(tmpdir(), 'nexus-platform-evidence-'));
	const archive = resolve(temporary, 'candidate.tar');
	try {
		run('git', ['-C', repositoryDir, 'archive', '--format=tar', '-o', archive, identity.head]);
		const imageIdentity = ensureDockerImage(policy.platform.image);
		const laneScript = policy.platform.lanes
			.map((args) => ['bun', ...args]
				.map((part) => `'${part.replaceAll("'", "'\\''")}'`).join(' '))
			.join('\n');
		const script = [
			'set -eu',
			'mkdir -p /candidate',
			'tar -xf /candidate.tar -C /candidate',
			'cd /candidate/nexus',
			laneScript,
		].join('\n');
		const environmentArgs = Object.entries(policy.platform.environment)
			.flatMap(([name, value]) => ['--env', `${name}=${value}`]);
		run('docker', [
			'run', '--rm',
			...environmentArgs,
			'--mount', `type=bind,source=${archive},target=/candidate.tar,readonly`,
			policy.platform.image,
			'sh', '-lc', script,
		], { inherit: true });
		const body: Omit<PlatformEvidence, 'evidenceSha256'> = {
			schemaVersion: 1,
			recordedAt: new Date().toISOString(),
			head: identity.head,
			tree: identity.tree,
			image: policy.platform.image,
			imageIdentity,
			environment: policy.platform.environment,
			platform: 'linux',
			lanes: policy.platform.lanes.map((args) => ({ args, status: 'PASS' })),
			toolSha256: toolHashes(policy),
		};
		const evidence: PlatformEvidence = { ...body, evidenceSha256: platformEvidenceDigest(body) };
		mkdirSync(artifactsDir, { recursive: true });
		writeImmutableEvidenceFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
		console.log(`closeout-platform: PASS head=${identity.head} image=${imageIdentity}`);
	} finally {
		rmSync(temporary, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 100,
		});
	}
}

interface HostedRun {
	databaseId: number;
	headSha: string;
	status: string;
	conclusion: string;
	url: string;
	workflowName: string;
}

interface HostedEvidence {
	status: string;
	detail: string;
}

interface VerifiedCloseout {
	head: string;
	tree: string;
	base: string;
	receipts: readonly CloseoutReceipt[];
	platform: PlatformEvidence;
	mainPosition: 'base' | 'head';
}

async function hostedEvidence(head: string): Promise<HostedEvidence> {
	const repository = parseGitHubRepository(git('remote', 'get-url', 'origin'));
	const response = await githubReadJson<{ workflow_runs?: Array<{
		id: number;
		head_sha: string;
		status: string;
		conclusion: string;
		html_url: string;
		name: string;
	}> }>(`/repos/${repository}/actions/runs?head_sha=${encodeURIComponent(head)}&per_page=100`);
	const runs: HostedRun[] = (response.workflow_runs ?? []).map((item) => ({
		databaseId: item.id,
		headSha: item.head_sha,
		status: item.status,
		conclusion: item.conclusion,
		url: item.html_url,
		workflowName: item.name,
	}));
	const exactRuns = runs.filter((item) => item.headSha === head);
	if (exactRuns.length === 0) {
		return { status: 'NOT_APPLICABLE', detail: `No hosted workflow run exists for exact head ${head}` };
	}
	if (exactRuns.some((item) => item.status !== 'completed')) {
		throw new Error('hosted exact-head workflows are still pending');
	}
	const failed = exactRuns.filter((item) => !['success', 'skipped'].includes(item.conclusion));
	if (failed.length === 0) {
		return {
			status: 'SUCCESS',
			detail: exactRuns.map((item) => `${item.workflowName}:${item.url}`).join(' | '),
		};
	}
	const infraRuns: HostedRun[] = [];
	for (const workflow of failed) {
		const jobsResponse = await githubReadJson<{ jobs?: Array<{
			conclusion?: string;
			runner_id?: number;
			steps?: unknown[];
			check_run_url?: string;
		}> }>(`/repos/${repository}/actions/runs/${workflow.databaseId}/jobs?per_page=100`);
		const failedJobs = (jobsResponse.jobs ?? []).filter((job) => job.conclusion === 'failure');
		let billingOnly = failedJobs.length > 0;
		for (const job of failedJobs) {
			let annotationText = '';
			if (job.check_run_url) {
				const annotationPath = `${new URL(job.check_run_url).pathname}/annotations`;
				annotationText = JSON.stringify(await githubReadJson<unknown[]>(annotationPath));
			}
			const allocationRejected = job.runner_id === 0 && (job.steps?.length ?? 0) === 0;
			const billingAnnotation = /payments? have failed|spending limit|billing/iu.test(annotationText);
			if (!allocationRejected || !billingAnnotation) billingOnly = false;
		}
		if (billingOnly) infraRuns.push(workflow);
	}
	if (infraRuns.length === failed.length) {
		return {
			status: 'INFRA_UNAVAILABLE',
			detail: infraRuns.map((item) => `${item.workflowName}:${item.url}:runner allocation rejected by billing/spending limit`).join(' | '),
		};
	}
	throw new Error(`hosted exact-head product checks failed: ${failed.map((item) => item.url).join(', ')}`);
}

export async function browserHostIdentity(): Promise<Record<string, unknown>> {
	const haloRequire = createRequire(resolve(workspaceDir, 'apps/extension-halo/package.json'));
	const spectraRequire = createRequire(resolve(workspaceDir, 'apps/extension-spectra/package.json'));
	const playwright = haloRequire('playwright') as { chromium: BrowserOwner };
	const puppeteerModule = spectraRequire('puppeteer') as BrowserOwner & { default?: BrowserOwner };
	const puppeteer = puppeteerModule.default ?? puppeteerModule;
	const browsers = {
		playwrightChromium: await inspectBrowser('playwrightChromium', playwright.chromium),
		puppeteerChrome: await inspectBrowser('puppeteerChrome', puppeteer),
	};
	return {
		platform: process.platform,
		arch: arch(),
		osRelease: osRelease(),
		bun: Bun.version,
		nodeCompatibility: process.version,
		browsers,
	};
}

function equalCanonical(left: unknown, right: unknown, label: string): void {
	if (canonical(left) !== canonical(right)) throw new Error(`${label} differs across closeout attempts`);
}

export function assertPlatformEvidenceSnapshot(
	current: PlatformEvidence,
	recorded: PlatformEvidence,
): void {
	equalCanonical(current, recorded, 'current Linux platform evidence');
}

export function classifyMainPosition(
	current: string,
	verified: { head: string; base: string },
	allowPromoted: boolean,
): 'base' | 'head' {
	if (current === verified.base) return 'base';
	if (allowPromoted && current === verified.head) return 'head';
	throw new Error(allowPromoted
		? 'remote main is neither the verified base nor the promoted head'
		: 'remote main moved after evidence recording');
}

export function isExactPromotionProjection(
	pull: { state: string; merged_at?: string | null; merge_commit_sha?: string | null },
	head: string,
): boolean {
	if (pull.state !== 'closed') return false;
	if (pull.merged_at || pull.merge_commit_sha) {
		return Boolean(pull.merged_at) && pull.merge_commit_sha === head;
	}
	return true;
}

export function assertSameRepositoryPull(headRepository: string, baseRepository: string): void {
	if (!headRepository || !baseRepository || headRepository !== baseRepository) {
		throw new Error('exact ref promotion requires a same-repository pull request');
	}
}

export function validateReceiptDocuments(
	receipts: CloseoutReceipt[],
	policy: CloseoutPolicy,
): { head: string; tree: string; base: string } {
	if (receipts.length !== policy.requiredAttempts) {
		throw new Error(`expected ${policy.requiredAttempts} receipts, found ${receipts.length}`);
	}
	const ordered = [...receipts].sort((left, right) => left.attempt - right.attempt);
	for (const [index, receipt] of ordered.entries()) {
		validateReceiptDocument(receipt, policy, index + 1);
	}
	const first = ordered[0];
	if (!first) throw new Error('closeout receipts are missing');
	for (const receipt of ordered.slice(1)) {
		for (const key of ['head', 'tree', 'base'] as const) {
			if (receipt[key] !== first[key]) throw new Error(`${key} differs across closeout attempts`);
		}
		equalCanonical(receipt.versions, first.versions, 'product versions');
		equalCanonical(receipt.artifacts, first.artifacts, 'release artifacts');
		equalCanonical(receipt.toolSha256, first.toolSha256, 'closeout tool identity');
		equalCanonical(receipt.host, first.host, 'host/toolchain identity');
		equalCanonical(receipt.platform, first.platform, 'Linux platform evidence');
	}
	return { head: first.head, tree: first.tree, base: first.base };
}

export function validateReceiptDocument(
	receipt: CloseoutReceipt,
	policy: CloseoutPolicy,
	expectedAttempt: number,
): void {
	const { receiptSha256, ...body } = receipt;
	if (receipt.schemaVersion !== 1 || receipt.attempt !== expectedAttempt) {
		throw new Error(`closeout receipt attempt ${expectedAttempt} has invalid identity`);
	}
	if (receiptDigest(body) !== receiptSha256) {
		throw new Error(`closeout receipt attempt ${receipt.attempt} digest mismatch`);
	}
	if (!SHA_PATTERN.test(receipt.head) || !SHA_PATTERN.test(receipt.tree)
		|| !SHA_PATTERN.test(receipt.base)) throw new Error('receipt Git identity is invalid');
	if (!policy.allowedHostedStatuses.includes(receipt.hosted.status)) {
		throw new Error(`receipt hosted status is invalid: ${receipt.hosted.status}`);
	}
	if (receipt.lanes.length !== policy.lanes.length
		|| receipt.lanes.some((lane, laneIndex) => (
			lane.status !== 'PASS'
			|| lane.label !== policy.lanes[laneIndex]?.label
			|| canonical(lane.args) !== canonical(policy.lanes[laneIndex]?.args)
		))) throw new Error(`closeout receipt attempt ${receipt.attempt} has incomplete lanes`);
}

function assertSingleCommitCandidate(identity: { head: string; base: string }): void {
	const parent = git('rev-parse', `${identity.head}^`);
	const count = Number(git('rev-list', '--count', `${identity.base}..${identity.head}`));
	if (parent !== identity.base || count !== 1) {
		throw new Error('closeout candidate must be one squash-equivalent commit whose parent is the exact base');
	}
}

async function record(): Promise<void> {
	const policy = readPolicy();
	const attempt = Number(valueAfter('--attempt'));
	const base = valueAfter('--base') ?? '';
	if (!Number.isInteger(attempt) || attempt < 1 || attempt > policy.requiredAttempts) {
		throw new Error(`--attempt must be 1..${policy.requiredAttempts}`);
	}
	if (!SHA_PATTERN.test(base)) throw new Error('--base must be an exact 40-character commit SHA');
	const identity = assertCleanExactHead();
	if (remoteMain() !== base) throw new Error('remote main moved before closeout recording');
	assertSingleCommitCandidate({ head: identity.head, base });
	const beforeTools = toolHashes(policy);
	const platform = readPlatformEvidence(policy, identity);
	const releaseVersions = versions(policy);
	const output = closeoutReceiptPath(identity.head, attempt);
	if (existsSync(output)) {
		const existing = JSON.parse(readFileSync(output, 'utf8')) as CloseoutReceipt;
		validateReceiptDocument(existing, policy, attempt);
		if (existing.head !== identity.head || existing.tree !== identity.tree || existing.base !== base) {
			throw new Error('existing closeout receipt is not bound to the current candidate');
		}
		equalCanonical(existing.versions, releaseVersions, 'existing product versions');
		equalCanonical(existing.toolSha256, beforeTools, 'existing closeout tool identity');
		equalCanonical(existing.platform, platform, 'existing Linux platform evidence');
		equalCanonical(existing.artifacts, artifactEvidence(policy, releaseVersions), 'existing release artifacts');
		equalCanonical(existing.host, await browserHostIdentity(), 'existing host/toolchain identity');
		const currentHosted = await hostedEvidence(identity.head);
		if (!policy.allowedHostedStatuses.includes(currentHosted.status)) {
			throw new Error(`derived hosted status is invalid: ${currentHosted.status}`);
		}
		console.log(
			`closeout-evidence: PASS existing ${relative(workspaceDir, output)} hosted-now=${currentHosted.status}`,
		);
		return;
	}
	const hosted = await hostedEvidence(identity.head);
	if (!policy.allowedHostedStatuses.includes(hosted.status)) throw new Error(`derived hosted status is invalid: ${hosted.status}`);
	const lanes: CloseoutReceiptBody['lanes'] = [];
	for (const lane of policy.lanes) {
		const started = performance.now();
		console.log(`\ncloseout ${attempt}/${policy.requiredAttempts}: ${lane.label}`);
		run(process.execPath, lane.args, { inherit: true });
		lanes.push({
			label: lane.label,
			args: lane.args,
			status: 'PASS',
			durationMs: Math.round(performance.now() - started),
		});
		const afterLane = assertCleanExactHead(identity.head);
		if (afterLane.tree !== identity.tree) throw new Error(`${lane.label} changed the candidate tree`);
	}
	const afterTools = toolHashes(policy);
	equalCanonical(afterTools, beforeTools, 'tool identity during closeout');
	const body: CloseoutReceiptBody = {
		schemaVersion: 1,
		attempt,
		recordedAt: new Date().toISOString(),
		head: identity.head,
		tree: identity.tree,
		base,
		versions: releaseVersions,
		lanes,
		artifacts: artifactEvidence(policy, releaseVersions),
		toolSha256: afterTools,
		host: await browserHostIdentity(),
		hosted,
		platform,
	};
	const receipt: CloseoutReceipt = { ...body, receiptSha256: receiptDigest(body) };
	mkdirSync(artifactsDir, { recursive: true });
	writeImmutableEvidenceFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
	console.log(`closeout-evidence: PASS ${relative(workspaceDir, output)}`);
}

function verify(options: { allowPromoted?: boolean } = {}): VerifiedCloseout {
	const policy = readPolicy();
	const expectedHead = valueAfter('--head');
	if (expectedHead && !SHA_PATTERN.test(expectedHead)) {
		throw new Error('--head must be an exact 40-character commit SHA');
	}
	const current = assertCleanExactHead(expectedHead);
	const receipts = Array.from({ length: policy.requiredAttempts }, (_, index) => {
		const path = closeoutReceiptPath(current.head, index + 1);
		if (!existsSync(path)) throw new Error(`missing closeout receipt: ${relative(workspaceDir, path)}`);
		return JSON.parse(readFileSync(path, 'utf8')) as CloseoutReceipt;
	});
	const verified = validateReceiptDocuments(receipts, policy);
	if (expectedHead && expectedHead !== verified.head) throw new Error('--head differs from receipt head');
	if (current.head !== verified.head) throw new Error('current Git head differs from verified head');
	if (current.tree !== verified.tree) throw new Error('current Git tree differs from verified tree');
	const mainPosition = classifyMainPosition(remoteMain(), verified, options.allowPromoted === true);
	assertSingleCommitCandidate(verified);
	equalCanonical(toolHashes(policy), receipts[0]?.toolSha256, 'current closeout tool identity');
	const platform = readPlatformEvidence(policy, current);
	const recordedPlatform = receipts[0]?.platform;
	if (!recordedPlatform) throw new Error('closeout receipt is missing Linux platform evidence');
	assertPlatformEvidenceSnapshot(platform, recordedPlatform);
	const currentArtifacts = artifactEvidence(policy, receipts[0]?.versions ?? {});
	equalCanonical(currentArtifacts, receipts[0]?.artifacts, 'current release artifacts');
	console.log(
		`closeout-verify: PASS head=${verified.head} tree=${verified.tree} base=${verified.base}`
		+ ` main=${mainPosition} attempts=${policy.requiredAttempts}`,
	);
	return {
		...verified,
		receipts: Object.freeze(receipts),
		platform,
		mainPosition,
	};
}

async function persistEvidenceComment(
	pr: string,
	repository: string,
	verified: VerifiedCloseout,
	finalHosted: HostedEvidence,
): Promise<void> {
	const receipts = verified.receipts;
	const hostedLines = receipts.map((receipt) => {
		const detail = receipt.hosted.detail
			.replace(/[\r\n\t]+/gu, ' ')
			.replaceAll('`', "'")
			.slice(0, 3_000);
		return `  - attempt ${receipt.attempt}: ${receipt.hosted.status} — ${detail}`;
	});
	const marker = `<!-- nexus-closeout-evidence:${verified.head} -->`;
	const finalHostedDetail = finalHosted.detail
		.replace(/[\r\n\t]+/gu, ' ')
		.replaceAll('`', "'")
		.slice(0, 3_000);
	const body = [
		marker,
		'Exact-head local closeout evidence (machine-generated)',
		`- head: \`${verified.head}\``,
		`- tree: \`${verified.tree}\``,
		`- base: \`${verified.base}\``,
		`- receipt SHA-256: ${receipts.map((receipt) => `\`${receipt.receiptSha256}\``).join(', ')}`,
		`- HALO artifact: \`${receipts[0]?.artifacts.halo?.sha256 ?? ''}\``,
		`- SPECTRA artifact: \`${receipts[0]?.artifacts.spectra?.sha256 ?? ''}\``,
		`- Linux platform image: \`${receipts[0]?.platform.image ?? ''}\``,
		`- Linux platform evidence: \`${receipts[0]?.platform.evidenceSha256 ?? ''}\``,
		'- hosted replay:',
		...hostedLines,
		`- promotion-time hosted replay: ${finalHosted.status} — ${finalHostedDetail}`,
	].join('\n');
	const mutation = run('gh', ['pr', 'comment', pr, '--body', body], {
		allowFailure: true,
		timeoutMs: 60_000,
	});
	const comments = await githubReadJson<Array<{ body?: string }>>(
		`/repos/${repository}/issues/${pr}/comments?per_page=100&sort=created&direction=desc`,
	);
	if (!comments.some((comment) => comment.body === body)) {
		if (mutation.status !== 0) throw new Error(`durable PR evidence comment failed: ${mutation.stderr}`);
		throw new Error('durable PR evidence comment readback failed');
	}
}

function deleteRemoteBranchExact(branch: string, expectedHead: string): void {
	run('git', ['check-ref-format', '--branch', branch]);
	const refName = `refs/heads/${branch}`;
	let lastError = 'unknown failure';
	for (let attempt = 1; attempt <= GIT_REMOTE_READ_ATTEMPTS; attempt += 1) {
		const current = remoteRef(refName);
		if (!current) return;
		if (current !== expectedHead) throw new Error('ref cleanup refuses a moved candidate head');
		const result = run('git', [
			'push', `--force-with-lease=${refName}:${expectedHead}`, 'origin', '--delete', branch,
		], { allowFailure: true, timeoutMs: 120_000 });
		const after = remoteRef(refName);
		if (!after) return;
		if (after !== expectedHead) throw new Error('ref cleanup observed a moved candidate head');
		lastError = result.stderr || `exit ${result.status}`;
		if (attempt < GIT_REMOTE_READ_ATTEMPTS) Bun.sleepSync(Math.min(1_000 * 2 ** (attempt - 1), 8_000));
	}
	throw new Error(`remote candidate ref deletion failed after ${GIT_REMOTE_READ_ATTEMPTS} attempts: ${lastError}`);
}

export function mainPromotionArgs(head: string, base: string, branch: string): string[] {
	if (!SHA_PATTERN.test(head) || !SHA_PATTERN.test(base)) throw new Error('main promotion requires exact Git SHAs');
	const forbidden = [' ', '\t', '\r', '\n', '~', '^', ':', '?', '*', '[', '\\'];
	if (!branch || branch === 'main' || branch.startsWith('-')
		|| branch.includes('..') || forbidden.some((value) => branch.includes(value))) {
		throw new Error('main promotion requires a distinct canonical candidate branch');
	}
	const candidateRef = `refs/heads/${branch}`;
	return [
		'push',
		'--atomic',
		`--force-with-lease=refs/heads/main:${base}`,
		`--force-with-lease=${candidateRef}:${head}`,
		'origin',
		`${head}:refs/heads/main`,
		`:${candidateRef}`,
	];
}

function promoteMainExact(head: string, base: string, branch: string): void {
	run('git', ['check-ref-format', '--branch', branch]);
	const candidateRef = `refs/heads/${branch}`;
	let lastError = 'unknown failure';
	for (let attempt = 1; attempt <= GIT_REMOTE_READ_ATTEMPTS; attempt += 1) {
		const currentMain = remoteMain();
		const currentCandidate = remoteRef(candidateRef);
		if (currentMain === head && currentCandidate === undefined) return;
		if (currentMain !== base) throw new Error('main promotion refuses a moved exact base');
		if (currentCandidate !== head) throw new Error('main promotion refuses a moved exact candidate head');
		const result = run('git', mainPromotionArgs(head, base, branch), {
			allowFailure: true,
			timeoutMs: 120_000,
		});
		const afterMain = remoteMain();
		const afterCandidate = remoteRef(candidateRef);
		if (afterMain === head && afterCandidate === undefined) return;
		if (afterMain !== base || afterCandidate !== head) {
			throw new Error('atomic promotion observed a partial or unexpected concurrent ref update');
		}
		lastError = result.stderr || `exit ${result.status}`;
		if (attempt < GIT_REMOTE_READ_ATTEMPTS) Bun.sleepSync(Math.min(1_000 * 2 ** (attempt - 1), 8_000));
	}
	throw new Error(`exact-base/head atomic promotion failed after ${GIT_REMOTE_READ_ATTEMPTS} attempts: ${lastError}`);
}

async function merge(): Promise<void> {
	const verified = verify({ allowPromoted: true });
	const policy = readPolicy();
	const pr = valueAfter('--pr');
	if (!pr || !/^\d+$/u.test(pr)) throw new Error('--pr must be a pull request number');
	const repository = parseGitHubRepository(git('remote', 'get-url', 'origin'));
	const pull = await githubReadJson<{
		state: string;
		draft: boolean;
		head: { sha: string; ref: string; repo?: { full_name?: string } };
		base: { sha: string; ref: string; repo?: { full_name?: string } };
	}>(`/repos/${repository}/pulls/${pr}`);
	const headRepository = pull.head.repo?.full_name;
	const baseRepository = pull.base.repo?.full_name;
	assertSameRepositoryPull(headRepository ?? '', baseRepository ?? '');
	const metadata = {
		headRefOid: pull.head.sha,
		headRefName: pull.head.ref,
		baseRefName: pull.base.ref,
		baseRefOid: pull.base.sha,
		state: pull.state,
		isDraft: pull.draft,
	};
	let mainPosition = classifyMainPosition(remoteMain(), verified, true);
	if (metadata.baseRefName !== policy.targetBranch || metadata.headRefOid !== verified.head) {
		throw new Error('pull request is not bound to the verified candidate');
	}
	if (mainPosition === 'base' && (
		metadata.state !== 'open' || metadata.isDraft || metadata.baseRefOid !== verified.base
	)) {
		throw new Error('pull request is not a ready exact-head main candidate');
	}
	const hostedBeforeComment = await hostedEvidence(verified.head);
	if (!policy.allowedHostedStatuses.includes(hostedBeforeComment.status)) {
		throw new Error(`derived hosted status is invalid: ${hostedBeforeComment.status}`);
	}
	await persistEvidenceComment(pr, repository, verified, hostedBeforeComment);
	const hostedBeforePromotion = await hostedEvidence(verified.head);
	if (!policy.allowedHostedStatuses.includes(hostedBeforePromotion.status)) {
		throw new Error(`derived hosted status is invalid: ${hostedBeforePromotion.status}`);
	}
	equalCanonical(hostedBeforePromotion, hostedBeforeComment, 'hosted truth at promotion boundary');
	const beforePromotion = await githubReadJson<{
		state: string;
		draft: boolean;
		head: { sha: string; repo?: { full_name?: string } };
		base: { sha: string; ref: string; repo?: { full_name?: string } };
	}>(`/repos/${repository}/pulls/${pr}`);
	assertSameRepositoryPull(
		beforePromotion.head.repo?.full_name ?? '',
		beforePromotion.base.repo?.full_name ?? '',
	);
	mainPosition = classifyMainPosition(remoteMain(), verified, true);
	if (beforePromotion.head.sha !== verified.head
		|| beforePromotion.base.ref !== policy.targetBranch
		|| (mainPosition === 'base' && (
			beforePromotion.state !== 'open' || beforePromotion.draft
			|| beforePromotion.base.sha !== verified.base
		))) {
		throw new Error('pull request moved after evidence publication');
	}
	if (mainPosition === 'base') {
		promoteMainExact(verified.head, verified.base, metadata.headRefName);
	}
	let merged: {
		state: string;
		merged_at?: string | null;
		merge_commit_sha?: string | null;
		head?: { sha?: string };
		base?: { ref?: string };
	} | undefined;
	for (let attempt = 1; attempt <= 10; attempt += 1) {
		merged = await githubReadJson<NonNullable<typeof merged>>(`/repos/${repository}/pulls/${pr}`);
		if (merged.head?.sha !== verified.head || merged.base?.ref !== policy.targetBranch) {
			throw new Error('remote PR identity changed after exact ref promotion');
		}
		if (isExactPromotionProjection(merged, verified.head)) break;
		if (attempt < 10) await Bun.sleep(Math.min(500 * 2 ** (attempt - 1), 4_000));
	}
	if (!merged || !isExactPromotionProjection(merged, verified.head)) {
		throw new Error('remote PR did not close after the exact leased main promotion');
	}
	const mergeSha = verified.head;
	const mainRef = await githubReadJson<{ object?: { sha?: string } }>(
		`/repos/${repository}/git/ref/heads/${policy.targetBranch}`,
	);
	if (mainRef.object?.sha !== verified.head) throw new Error('remote main does not point to the verified candidate');
	const commit = await githubReadJson<{ tree?: { sha?: string } }>(
		`/repos/${repository}/git/commits/${mergeSha}`,
	);
	if (commit.tree?.sha !== verified.tree) throw new Error('promoted main tree differs from verified candidate tree');
	const remoteHead = remoteRef(`refs/heads/${metadata.headRefName}`);
	if (remoteHead !== undefined && remoteHead !== verified.head) throw new Error('ref cleanup refuses a moved candidate head');
	deleteRemoteBranchExact(metadata.headRefName, verified.head);
	if (remoteRef(`refs/heads/${metadata.headRefName}`)) throw new Error('remote candidate ref absence was not confirmed');
	console.log(`closeout-merge: PASS pr=${pr} merge=${mergeSha} tree=${verified.tree}`);
}

const mode = process.argv[2];
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (mode === 'platform-record') await platformRecord();
	else if (mode === 'record') await record();
	else if (mode === 'verify') verify();
	else if (mode === 'merge') await merge();
	else throw new Error('usage: closeout-evidence.ts <platform-record|record|verify|merge> [options]');
}
