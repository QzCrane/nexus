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
import { BUN_VERSION } from './toolchain-versions';
import { listCurrentToolchainFiles } from './toolchain-references';
import { parseNulSeparatedPaths } from './ci-product-scope.mjs';
import { collectHostedEvidence, requiredHostedPlan, validateHostedObservation, type HostedEvidence } from './closeout-hosted';
import { readFinalReleaseEvidence } from './release-artifact-provenance';
import { createDurableCloseoutBundle, readRemoteDurableCloseoutEvidence, publishDurableCloseoutEvidence, validateDurableCloseoutBundle, projectFinalDelivery, type DurableCloseoutBundleV1 } from './durable-evidence';

export interface CloseoutPolicy {
	schemaVersion: 1;
	requiredAttempts: number;
	targetBranch: string;
	hostedRequired: boolean;
	allowedHostedStatuses: string[];
	lanes: Array<{ label: string; args: string[] }>;
	products: Record<string, { versionFile: string; artifact: string }>;
	toolFiles: string[];
	toolInputs: 'tracked-toolchain-sources';
	platform: { image: string; environment: Record<string, string>; lanes: string[][] };
}

interface ArtifactEvidence {
	path: string;
	sha256: string;
	bytes: number;
}

interface ProductArtifactEvidence extends ArtifactEvidence {
	licenses: ArtifactEvidence;
	supplyChain: ArtifactEvidence;
	wholeArtifact: ArtifactEvidence;
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
	artifacts: Record<string, ProductArtifactEvidence>;
	toolSha256: Record<string, string>;
	host: Record<string, unknown>;
	hosted: HostedEvidence;
	source: { authority: 'local-execution-self-report'; authentication: 'none' };
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
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
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

export function readPolicy(path = policyPath): CloseoutPolicy {
	const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
	assertDocumentKeys(value, [
		'schemaVersion', 'requiredAttempts', 'targetBranch', 'hostedRequired',
		'allowedHostedStatuses', 'lanes', 'products', 'platform', 'toolInputs',
	], 'closeout contract');
	const policy = value as unknown as CloseoutPolicy;
	assertDocumentKeys(policy.products, ['halo', 'spectra'], 'closeout contract products');
	assertDocumentKeys(policy.platform, ['image', 'environment', 'lanes'], 'closeout contract platform');
	assertDocumentKeys(policy.platform.environment, ['PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD', 'PUPPETEER_SKIP_DOWNLOAD'], 'closeout contract environment');
	const image = policy.platform?.image?.match(/^oven\/bun:([^@]+)@sha256:[a-f0-9]{64}$/u);
	if (policy.schemaVersion !== 1 || policy.requiredAttempts !== 2
		|| policy.targetBranch !== 'main' || policy.hostedRequired !== false
		|| !Array.isArray(policy.lanes) || policy.lanes.length !== 2
		|| policy.toolInputs !== 'tracked-toolchain-sources'
		|| canonical(policy.allowedHostedStatuses) !== canonical(['SUCCESS', 'INFRA_UNAVAILABLE', 'NOT_APPLICABLE'])
		|| image?.[1] !== BUN_VERSION
		|| policy.platform.environment?.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD !== '1'
		|| policy.platform.environment?.PUPPETEER_SKIP_DOWNLOAD !== 'true'
		|| Object.keys(policy.platform.environment).length !== 2
		|| !Array.isArray(policy.platform.lanes) || policy.platform.lanes.length === 0) {
		throw new Error('closeout-policy.json does not satisfy the repository closeout contract');
	}
	const manifest = JSON.parse(readFileSync(resolve(workspaceDir, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
	for (const [index, product] of ['halo', 'spectra'].entries()) {
		const lane = policy.lanes[index];
		assertDocumentKeys(lane, ['label', 'args'], 'closeout contract release lane');
		if (!nonEmptyString(lane.label) || canonical(lane.args) !== canonical(['run', `release:${product}`])
			|| manifest.scripts[`release:${product}`] !== `bun scripts/release-${product}.ts`) {
			throw new Error('closeout contract must execute the canonical product release owners');
		}
		const config = policy.products[product];
		assertDocumentKeys(config, ['versionFile', 'artifact'], 'closeout contract product');
		const root = `apps/extension-${product}`;
		const staging = product === 'halo' ? '.staging/' : '';
		if (config.versionFile !== `${root}/package.json`
			|| config.artifact !== `${root}/release/${staging}${product}-v{version}.zip`) {
			throw new Error('closeout contract product paths differ from release ownership');
		}
	}
	const domainPolicy = JSON.parse(readFileSync(resolve(workspaceDir, 'dependency-domains.json'), 'utf8')) as {
		domains: Array<{ frozenInstall: string[]; lockfile: string }>;
	};
	const installs = domainPolicy.domains.map((domain) => domain.frozenInstall);
	const seen = new Set<string>();
	for (const args of policy.platform.lanes) {
		if (!Array.isArray(args) || args.some((arg) => !nonEmptyString(arg)) || seen.has(canonical(args))) {
			throw new Error('closeout contract platform lanes are malformed or duplicated');
		}
		seen.add(canonical(args));
		const install = installs.some((expected) => canonical(expected) === canonical(args));
		const script = args.length === 2 && args[0] === 'run'
			&& ['check:toolchain', 'check:governance'].includes(args[1] ?? '');
		const owner = args[0]?.startsWith('scripts/') && args.every((arg, index) => (
			index === 0 ? /^[a-zA-Z0-9/.-]+\.ts$/u.test(arg) && !arg.includes('..') : arg === '--check'
		));
		const tests = args[0] === 'test' && args.length > 1 && args.slice(1).every((arg) => (
			/^(?:scripts|apps\/extension-(?:halo|spectra)\/test)\/[a-zA-Z0-9.-]+\.(?:spec|test)\.ts$/u.test(arg)
		));
		if (!install && !script && !owner && !tests) throw new Error('closeout contract platform command is not admitted');
	}
	for (const command of [...installs, ['run', 'check:toolchain'], ['run', 'check:governance']]) {
		if (!seen.has(canonical(command))) throw new Error('closeout contract is missing a required platform owner');
	}
	const toolFiles = [...new Set([
		...listCurrentToolchainFiles(repositoryDir)
			.filter((file) => !file.endsWith('.md'))
			.map((file) => relative(workspaceDir, file).replaceAll('\\', '/')),
		...domainPolicy.domains.map((domain) => domain.lockfile),
	])].sort();
	return { ...policy, toolFiles };
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

async function githubRead<T>(
	path: string,
	options: GitHubReadOptions = {},
	format: 'json' | 'text' = 'json',
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
			let response = await fetchImpl(url, {
				redirect: 'manual',
				headers: {
					Accept: 'application/vnd.github+json',
					Authorization: `Bearer ${token}`,
					'User-Agent': 'nexus-closeout-evidence',
					'X-GitHub-Api-Version': '2022-11-28',
				},
				signal: AbortSignal.timeout(45_000),
			});
			if (response.status === 302 && format === 'text') {
				const location = response.headers.get('location');
				if (!location) throw new Error('GitHub REST read failed without retry: log redirect has no location');
				const download = new URL(location);
				if (download.protocol !== 'https:' || download.username || download.password
					|| !['.actions.githubusercontent.com', '.blob.core.windows.net'].some((suffix) => download.hostname.endsWith(suffix))) {
					throw new Error('GitHub REST read failed without retry: log redirect is not an admitted HTTPS provider download');
				}
				// Signed provider downloads are a separate origin. Never forward the
				// repository bearer token, cookies or a referrer to that request.
				response = await fetchImpl(download, { redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(45_000) });
			}
			const responseText = await readBoundedGitHubBody(response);
			if (response.ok) {
				if (format === 'text') return responseText as T;
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

export async function readBoundedGitHubBody(response: Response, limit = 20 * 1024 * 1024): Promise<string> {
	if (Number(response.headers.get('content-length')) > limit) {
		await response.body?.cancel();
		throw new Error('GitHub REST read failed without retry: response exceeds evidence limit');
	}
	if (!response.body) return '';
	const reader = response.body.getReader();
	const decoder = new TextDecoder('utf-8', { fatal: true });
	const parts: string[] = [];
	let bytes = 0;
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			bytes += next.value.byteLength;
			if (bytes > limit) {
				await reader.cancel();
				throw new Error('GitHub REST read failed without retry: response exceeds evidence limit');
			}
			parts.push(decoder.decode(next.value, { stream: true }));
		}
		parts.push(decoder.decode());
		return parts.join('');
	} finally { reader.releaseLock(); }
}

export function githubReadJson<T>(path: string, options: GitHubReadOptions = {}): Promise<T> {
	return githubRead<T>(path, options);
}

export function githubReadText(path: string, options: GitHubReadOptions = {}): Promise<string> {
	return githubRead<string>(path, options, 'text');
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
): Record<string, ProductArtifactEvidence> {
	return Object.fromEntries(Object.entries(policy.products).map(([product, config]) => {
		const version = releaseVersions[product];
		if (!version) throw new Error(`missing ${product} release version`);
		const relativePath = config.artifact.replace('{version}', version);
		const path = resolve(workspaceDir, relativePath);
		if (!existsSync(path)) throw new Error(`${product} release artifact is missing: ${relativePath}`);
		if (product !== 'halo' && product !== 'spectra') throw new Error('Unknown release product');
		const finalEvidence = readFinalReleaseEvidence(product);
		const local = (file: ArtifactEvidence): ArtifactEvidence => ({ ...file, path: relative(workspaceDir, resolve(repositoryDir, file.path)).replaceAll('\\', '/') });
		return [product, {
			path: relativePath.replaceAll('\\', '/'),
			sha256: fileSha256(path),
			bytes: statSync(path).size,
			licenses: local(finalEvidence.licenses),
			supplyChain: local(finalEvidence.supplyChain),
			wholeArtifact: local(finalEvidence.wholeArtifact),
		}];
	}));
}

interface BrowserOwner {
	executablePath(): string | Promise<string>;
}

async function inspectBrowser(owner: string, browserOwner: BrowserOwner): Promise<Record<string, unknown>> {
	// Product replay already supports an explicit installed Chrome. Record the
	// executable those lanes actually launch, rather than an unused driver cache.
	const path = process.env.NEXUS_CHROME_EXECUTABLE?.trim() || await browserOwner.executablePath();
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

export function platformEvidenceDigest(body: Omit<PlatformEvidence, 'evidenceSha256'>): string {
	return sha256Bytes(canonical(body));
}

export function assertDockerImageIdentity(image: string, identity: string): void {
	const pinned = image.match(/^(oven\/bun):[^@\s]+@(sha256:[a-f0-9]{64})$/u);
	if (!pinned) throw new Error(`Docker image is not pinned by digest: ${image}`);
	const expected = `${pinned[1]}@${pinned[2]}`;
	const [id, repositories, ...extra] = identity.trim().split(/\s+/u);
	const digests = repositories?.split(',').map((ref) => ref.replace(/^docker\.io\//u, '')) ?? [];
	if (!/^sha256:[a-f0-9]{64}$/u.test(id ?? '') || extra.length > 0 || !digests.includes(expected)) {
		throw new Error(`Docker image identity does not contain exact ${expected}: ${identity}`);
	}
}

export function parseDockerImageInspection(image: string, output: string): string {
	let parsed: unknown;
	try {
		parsed = JSON.parse(output);
	} catch {
		throw new Error('Docker image inspection returned invalid JSON');
	}
	if (!Array.isArray(parsed) || parsed.length !== 1 || !parsed[0] || typeof parsed[0] !== 'object') {
		throw new Error('Docker image inspection must describe exactly one image');
	}
	const entry = parsed[0] as { Id?: unknown; RepoDigests?: unknown; Os?: unknown };
	if (typeof entry.Id !== 'string' || entry.Os !== 'linux'
		|| !Array.isArray(entry.RepoDigests) || entry.RepoDigests.length === 0
		|| !entry.RepoDigests.every((ref): ref is string => (
			typeof ref === 'string' && /^[^\s,@]+@sha256:[a-f0-9]{64}$/u.test(ref)
		))) {
		throw new Error('Docker image inspection has invalid Linux image metadata');
	}
	const identity = `${entry.Id} ${[...entry.RepoDigests].sort().join(',')}`;
	assertDockerImageIdentity(image, identity);
	return identity;
}

export function ensureDockerImage(image: string, execute: typeof run = run): string {
	// Read the CLI's JSON contract. Go-template join rejects []interface{} on
	// some Docker versions even after a successful, digest-exact pull.
	const inspectArgs = ['image', 'inspect', image];
	const inspect = () => execute('docker', inspectArgs, { allowFailure: true, timeoutMs: 30_000 });
	let inspection = inspect();
	for (let attempt = 1; inspection.status !== 0 && attempt <= 3; attempt += 1) {
		const pull = execute('docker', ['pull', image], {
			inherit: true, allowFailure: true, timeoutMs: 120_000,
		});
		if (pull.status !== 0 && attempt === 3) {
			throw new Error(`Docker could not obtain exact image ${image} after ${attempt} attempts: ${pull.stderr}`);
		}
		inspection = inspect();
	}
	if (inspection.status !== 0) {
		throw new Error(`Docker image inspection failed for ${image}: ${inspection.stderr}`);
	}
	return parseDockerImageInspection(image, inspection.stdout);
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
	assertDockerImageIdentity(evidence.image, evidence.imageIdentity);
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
	const base = git('show', '-s', '--format=%P', head);
	assertCandidateParents(base.split(' ').filter(Boolean), base);
	const diff = spawnSync('git', ['diff', '--name-only', '--no-renames', '-z', base, head], { cwd: repositoryDir, shell: false });
	if (diff.error) throw diff.error;
	if (diff.status !== 0) throw new Error(`Hosted scope diff failed: ${String(diff.stderr)}`);
	const plan = requiredHostedPlan(repositoryDir, parseNulSeparatedPaths(diff.stdout));
	return collectHostedEvidence({ repository, head, tree: git('rev-parse', `${head}^{tree}`), base, plan },
		(path) => githubReadJson<Record<string, unknown>>(path), githubReadText);
}

export async function browserHostIdentity(): Promise<Record<string, unknown>> {
	const haloRequire = createRequire(resolve(workspaceDir, 'apps/extension-halo/package.json'));
	const spectraRequire = createRequire(resolve(workspaceDir, 'apps/extension-spectra/package.json'));
	const playwright = haloRequire('@playwright/test') as { chromium: BrowserOwner };
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
	// Before a provider merge, merge_commit_sha may retain a synthetic test merge.
	// Exact main/tree/ref readback separately proves a direct atomic promotion.
	if (pull.merged_at === null || pull.merged_at === undefined) return true;
	return typeof pull.merged_at === 'string'
		&& pull.merged_at.length > 0
		&& pull.merge_commit_sha === head;
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
	assertDocumentKeys(receipt, [
		'schemaVersion', 'attempt', 'recordedAt', 'head', 'tree', 'base', 'versions',
		'lanes', 'artifacts', 'toolSha256', 'host', 'hosted', 'platform', 'source', 'receiptSha256',
	], 'receipt');
	const { receiptSha256, ...body } = receipt;
	if (receipt.schemaVersion !== 1 || receipt.attempt !== expectedAttempt) {
		throw new Error(`closeout receipt attempt ${expectedAttempt} has invalid identity`);
	}
	if (receiptDigest(body) !== receiptSha256) {
		throw new Error(`closeout receipt attempt ${receipt.attempt} digest mismatch`);
	}
	assertTimestamp(receipt.recordedAt, 'receipt.recordedAt');
	assertDocumentKeys(receipt.source, ['authority', 'authentication'], 'receipt.source');
	if (receipt.source.authority !== 'local-execution-self-report' || receipt.source.authentication !== 'none') throw new Error('Local receipt cannot claim independent authentication');
	assertDocumentKeys(receipt.versions, Object.keys(policy.products), 'receipt.versions');
	assertDocumentKeys(receipt.artifacts, Object.keys(policy.products), 'receipt.artifacts');
	assertHashMap(receipt.toolSha256, policy.toolFiles, 'receipt.toolSha256');
	for (const [product, config] of Object.entries(policy.products)) {
		const version = receipt.versions[product];
		if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(version)) {
			throw new Error(`receipt ${product} version is invalid`);
		}
		const artifact = receipt.artifacts[product];
		assertDocumentKeys(artifact, ['path', 'sha256', 'bytes', 'licenses', 'supplyChain', 'wholeArtifact'], `receipt.artifacts.${product}`);
		if (artifact.path !== config.artifact.replace('{version}', version)
			|| !SHA256_PATTERN.test(artifact.sha256)
			|| !Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0) {
			throw new Error(`receipt ${product} artifact is invalid`);
		}
		for (const [key, suffix] of Object.entries({ licenses: '.licenses.json', supplyChain: '.provenance.json', wholeArtifact: '.artifact-provenance.json' })) {
			const sidecar = artifact[key as 'licenses' | 'supplyChain' | 'wholeArtifact'];
			assertDocumentKeys(sidecar, ['path', 'sha256', 'bytes'], `receipt ${product} ${key}`);
			if (sidecar.path !== `${artifact.path}${suffix}` || !SHA256_PATTERN.test(sidecar.sha256) || !Number.isSafeInteger(sidecar.bytes) || sidecar.bytes <= 0) throw new Error(`receipt ${product} final ${key} binding is invalid`);
		}
	}
	assertDocumentKeys(receipt.host, ['platform', 'arch', 'osRelease', 'bun', 'nodeCompatibility', 'browsers'], 'receipt.host');
	if (receipt.host.platform !== 'win32' || !['x64', 'arm64'].includes(String(receipt.host.arch))
		|| receipt.host.bun !== BUN_VERSION
		|| !nonEmptyString(receipt.host.osRelease) || !nonEmptyString(receipt.host.nodeCompatibility)) {
		throw new Error('receipt host must identify the actual pinned Windows runtime');
	}
	assertDocumentKeys(receipt.host.browsers, ['playwrightChromium', 'puppeteerChrome'], 'receipt.host.browsers');
	for (const browser of Object.values(receipt.host.browsers)) {
		assertDocumentKeys(browser, ['executable', 'version', 'bytes', 'sha256'], 'receipt browser');
		if (!nonEmptyString(browser.executable) || !nonEmptyString(browser.version)
			|| typeof browser.sha256 !== 'string' || !SHA256_PATTERN.test(browser.sha256)
			|| !Number.isSafeInteger(browser.bytes) || Number(browser.bytes) <= 0) {
			throw new Error('receipt browser identity is invalid');
		}
	}
	assertDocumentKeys(receipt.hosted, ['status', 'detail', 'authority', 'plan', 'runs'], 'receipt.hosted');
	if (!nonEmptyString(receipt.hosted.detail)) throw new Error('receipt hosted observation is missing');
	validateHostedObservation(receipt.hosted, receipt);
	assertDocumentKeys(receipt.platform, [
		'schemaVersion', 'recordedAt', 'head', 'tree', 'image', 'imageIdentity',
		'environment', 'platform', 'lanes', 'toolSha256', 'evidenceSha256',
	], 'receipt.platform');
	assertTimestamp(receipt.platform.recordedAt, 'receipt.platform.recordedAt');
	assertHashMap(receipt.platform.toolSha256, policy.toolFiles, 'receipt.platform.toolSha256');
	const { evidenceSha256, ...platformBody } = receipt.platform;
	if (receipt.platform.schemaVersion !== 1 || receipt.platform.platform !== 'linux'
		|| receipt.platform.head !== receipt.head || receipt.platform.tree !== receipt.tree
		|| receipt.platform.image !== policy.platform.image
		|| canonical(receipt.platform.environment) !== canonical(policy.platform.environment)
		|| canonical(receipt.platform.toolSha256) !== canonical(receipt.toolSha256)
		|| !SHA256_PATTERN.test(evidenceSha256) || platformEvidenceDigest(platformBody) !== evidenceSha256) {
		throw new Error('receipt Linux platform binding is invalid');
	}
	assertDockerImageIdentity(receipt.platform.image, receipt.platform.imageIdentity);
	if (!Array.isArray(receipt.platform.lanes)
		|| receipt.platform.lanes.length !== policy.platform.lanes.length) {
		throw new Error('receipt platform lanes are incomplete');
	}
	for (const [index, lane] of receipt.platform.lanes.entries()) {
		assertDocumentKeys(lane, ['args', 'status'], 'receipt platform lane');
		if (lane.status !== 'PASS' || canonical(lane.args) !== canonical(policy.platform.lanes[index])) {
			throw new Error('receipt platform lane is invalid');
		}
	}
	if (!Array.isArray(receipt.lanes)) throw new Error('receipt lanes must be an array');
	for (const lane of receipt.lanes) {
		assertDocumentKeys(lane, ['label', 'args', 'status', 'durationMs'], 'receipt lane');
		if (!Number.isFinite(lane.durationMs) || lane.durationMs < 0) {
			throw new Error('receipt lane duration is invalid');
		}
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

function nonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function assertDocumentKeys(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| canonical(Object.keys(value).sort()) !== canonical([...keys].sort())) {
		throw new Error(`${label} has missing or unexpected fields`);
	}
}

function assertTimestamp(value: unknown, label: string): void {
	if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))
		|| new Date(value).toISOString() !== value) throw new Error(`${label} is not an ISO UTC timestamp`);
}

function assertHashMap(value: unknown, keys: readonly string[], label: string): void {
	assertDocumentKeys(value, keys, label);
	if (Object.values(value).some((hash) => typeof hash !== 'string' || !SHA256_PATTERN.test(hash))) {
		throw new Error(`${label} contains an invalid SHA-256`);
	}
}

export function assertCandidateParents(parents: readonly string[], base: string): void {
	if (!SHA_PATTERN.test(base) || parents.length !== 1 || parents[0] !== base) {
		throw new Error('closeout candidate must have exactly one parent equal to the exact base');
	}
}

function assertSingleCommitCandidate(identity: { head: string; base: string }): void {
	const parents = git('show', '-s', '--format=%P', identity.head).split(' ').filter(Boolean);
	assertCandidateParents(parents, identity.base);
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
		source: { authority: 'local-execution-self-report', authentication: 'none' },
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
	bundle: DurableCloseoutBundleV1,
): Promise<void> {
	const verified = bundle.candidate;
	const receipts = bundle.receipts as unknown as CloseoutReceipt[];
	const finalHosted = bundle.deliverySnapshot.hosted;
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
		`- as of: ${bundle.deliverySnapshot.asOf}`,
		`- durable source: \`${bundle.notesRef}\` at candidate \`${verified.head}\``,
		`- complete evidence bundle SHA-256: \`${bundle.bundleSha256}\``,
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
	const containsBody = async () => {
		for (let page = 1; page <= 100; page += 1) {
			const comments = await githubReadJson<Array<{ body?: string }>>(`/repos/${repository}/issues/${pr}/comments?per_page=100&page=${page}`);
			if (!Array.isArray(comments)) throw new Error('PR comment inventory is malformed');
			if (comments.some((comment) => comment.body === body)) return true;
			if (comments.length < 100) return false;
		}
		throw new Error('PR comment inventory exceeds complete-read limit');
	};
	if (await containsBody()) return;
	const directory = mkdtempSync(resolve(artifactsDir, 'closeout-comment-'));
	try {
		const bodyPath = resolve(directory, 'body.md');
		writeFileSync(bodyPath, body, 'utf8');
		const mutation = run('gh', ['pr', 'comment', pr, '--body-file', bodyPath], { allowFailure: true, timeoutMs: 60_000 });
		if (!await containsBody()) throw new Error(`durable PR evidence comment readback failed: ${mutation.stderr}`);
	} finally { rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
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
	const retained = readRemoteDurableCloseoutEvidence(pull.head.sha, { repositoryDir }).bundle;
	if (retained) {
		// Recovery restores evidence only. Current artifacts, tools, browser host,
		// refs and provider truth still pass the ordinary exact-head verifier.
		validateReceiptDocuments(retained.receipts as unknown as CloseoutReceipt[], policy);
		mkdirSync(artifactsDir, { recursive: true });
		for (const receipt of retained.receipts as unknown as CloseoutReceipt[]) {
			const path = closeoutReceiptPath(receipt.head, receipt.attempt);
			if (!existsSync(path)) writeImmutableEvidenceFile(path, `${JSON.stringify(receipt, null, 2)}\n`);
		}
		const path = platformEvidencePath(retained.candidate.head);
		if (!existsSync(path)) writeImmutableEvidenceFile(path, `${JSON.stringify(retained.platform, null, 2)}\n`);
	}
	const verified = verify({ allowPromoted: true });
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
	const hostedBeforePromotion = await hostedEvidence(verified.head);
	if (!policy.allowedHostedStatuses.includes(hostedBeforePromotion.status)) {
		throw new Error(`derived hosted status is invalid: ${hostedBeforePromotion.status}`);
	}
	equalCanonical(hostedBeforePromotion, hostedBeforeComment, 'hosted truth at promotion boundary');
	const candidate = { head: verified.head, tree: verified.tree, base: verified.base, pr: Number(pr), headRef: `refs/heads/${metadata.headRefName}`, baseRef: `refs/heads/${policy.targetBranch}` };
	let bundle = retained;
	if (bundle) {
		validateDurableCloseoutBundle(bundle, candidate);
		equalCanonical(bundle.receipts, verified.receipts, 'durable full receipts');
		equalCanonical(bundle.platform, verified.platform, 'durable platform receipt');
	} else {
		if (mainPosition !== 'base' || remoteRef(candidate.headRef) !== verified.head) throw new Error('Durable evidence must be published before candidate promotion');
		bundle = createDurableCloseoutBundle({ repository, candidate, receipts: [...verified.receipts], platform: verified.platform, deliverySnapshot: {
			authority: 'git-remote-and-github-rest-observation', asOf: new Date().toISOString(),
			refs: { main: { ref: candidate.baseRef, head: remoteMain() }, candidate: { ref: candidate.headRef, head: remoteRef(candidate.headRef) ?? '' } },
			pullRequest: { number: Number(pr), state: 'open', draft: false, head: metadata.headRefOid, base: metadata.baseRefOid, headRef: candidate.headRef, baseRef: candidate.baseRef },
			receipts: verified.receipts.map((receipt) => ({ attempt: receipt.attempt, sha256: receipt.receiptSha256 })),
			hosted: hostedBeforePromotion, result: 'VERIFIED_PENDING_PROMOTION',
			pending: ['atomic-main-promotion', 'provider-projection-readback', 'local-settlement'],
		} });
	}
	publishDurableCloseoutEvidence(bundle, { repositoryDir });
	await persistEvidenceComment(pr, repository, bundle);
	const hostedAfterPublication = await hostedEvidence(verified.head);
	equalCanonical(hostedAfterPublication, hostedBeforePromotion, 'hosted truth after durable publication');
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
	const delivery = projectFinalDelivery(bundle, {
		asOf: new Date().toISOString(),
		main: { ref: candidate.baseRef, head: verified.head, tree: verified.tree },
		candidate: { ref: candidate.headRef, head: null },
		pullRequest: { number: Number(pr), state: 'closed', head: verified.head, baseRef: candidate.baseRef,
			mergedAt: merged.merged_at ?? null, mergeCommitSha: merged.merge_commit_sha ?? null },
		pending: ['local-settlement'],
	});
	writeFileSync(resolve(artifactsDir, `delivery.${verified.head}.json`), `${JSON.stringify(delivery, null, 2)}\n`, 'utf8');
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
