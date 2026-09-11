import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
	assertPlatformEvidenceSnapshot,
	browserHostIdentity,
	assertSameRepositoryPull,
	assertDockerImageIdentity,
	parseDockerImageInspection,
	ensureDockerImage,
	classifyMainPosition,
	githubReadJson,
	isExactPromotionProjection,
	mainPromotionArgs,
	parseGitHubRepository,
	parseRemoteRef,
	receiptDigest,
	readPolicy,
	validateReceiptDocuments,
	validateReceiptDocument,
	writeImmutableEvidenceFile,
	type CloseoutPolicy,
	type CloseoutReceipt,
} from './closeout-evidence';
import { BUN_VERSION } from './toolchain-versions';

test('closeout identity follows the explicit replay executable and rejects a missing override', async () => {
	const previous = process.env.NEXUS_CHROME_EXECUTABLE;
	try {
		// This checks path selection, not browser behavior. Product lanes still
		// must launch Chrome before any release receipt can be issued.
		process.env.NEXUS_CHROME_EXECUTABLE = process.execPath;
		const identity = await browserHostIdentity();
		const browsers = identity.browsers as Record<string, { sha256: string }>;
		expect(browsers.playwrightChromium.sha256).toBe(browsers.puppeteerChrome.sha256);
		process.env.NEXUS_CHROME_EXECUTABLE = `${process.execPath}.missing-closeout-test`;
		await expect(browserHostIdentity()).rejects.toThrow('browser executable is missing');
	} finally {
		if (previous === undefined) delete process.env.NEXUS_CHROME_EXECUTABLE;
		else process.env.NEXUS_CHROME_EXECUTABLE = previous;
	}
});

const policy = JSON.parse(
	readFileSync(new URL('../closeout-policy.json', import.meta.url), 'utf8'),
) as CloseoutPolicy;

function receipt(attempt: number): CloseoutReceipt {
	const body = {
		schemaVersion: 1 as const,
		attempt,
		recordedAt: `2026-08-13T00:00:0${attempt}.000Z`,
		head: '1'.repeat(40),
		tree: '2'.repeat(40),
		base: '3'.repeat(40),
		versions: { halo: '0.6.2', spectra: '1.4.2' },
		lanes: policy.lanes.map((lane) => ({
			...lane,
			status: 'PASS' as const,
			durationMs: attempt * 100,
		})),
		artifacts: {
			halo: { path: 'halo.zip', sha256: '4'.repeat(64), bytes: 100 },
			spectra: { path: 'spectra.zip', sha256: '5'.repeat(64), bytes: 200 },
		},
		toolSha256: { policy: '6'.repeat(64) },
		host: { platform: 'win32', bun: '1.4.0', chromium: 'test' },
		hosted: { status: 'INFRA_UNAVAILABLE', detail: 'runner was not allocated' },
		platform: {
			schemaVersion: 1 as const,
			recordedAt: '2026-08-13T00:00:00.000Z',
			head: '1'.repeat(40),
			tree: '2'.repeat(40),
			image: policy.platform.image,
			imageIdentity: 'sha256:test',
			environment: policy.platform.environment,
			platform: 'linux' as const,
			lanes: policy.platform.lanes.map((args) => ({ args, status: 'PASS' as const })),
			toolSha256: { policy: '6'.repeat(64) },
			evidenceSha256: '7'.repeat(64),
		},
	};
	return { ...body, receiptSha256: receiptDigest(body) };
}

describe('exact-head closeout governance', () => {
	test('reads the live closeout policy through the same validator used by record and merge', () => {
		expect(readPolicy()).toEqual(policy);
		expect(policy.platform.image.startsWith(`oven/bun:${BUN_VERSION}@sha256:`)).toBe(true);
		expect(policy.toolFiles).toContain('scripts/toolchain-versions.ts');
	});

	test('rejects stale or unpinned images and weakened attempt contracts at the actual read boundary', () => {
		const root = mkdtempSync(resolve(tmpdir(), 'nexus-closeout-policy-'));
		try {
			const path = resolve(root, 'closeout-policy.json');
			for (const image of [
				`oven/bun:0.0.0@sha256:${'a'.repeat(64)}`,
				`oven/bun:${BUN_VERSION}`,
				`oven/bun:${BUN_VERSION}@sha256:short`,
				`other/bun:${BUN_VERSION}@sha256:${'a'.repeat(64)}`,
			]) {
				writeFileSync(path, JSON.stringify({ ...policy, platform: { ...policy.platform, image } }));
				expect(() => readPolicy(path)).toThrow('closeout contract');
			}
			for (const changes of [{ requiredAttempts: 1 }, { targetBranch: 'other' }, { lanes: [] }, { products: {} }]) {
				writeFileSync(path, JSON.stringify({ ...policy, ...changes }));
				expect(() => readPolicy(path)).toThrow('closeout contract');
			}
		} finally {
			rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
		}
	});

	test('requires two complete same-head, same-tree and reproducible-artifact attempts', () => {
		expect(validateReceiptDocuments([receipt(1), receipt(2)], policy)).toEqual({
			head: '1'.repeat(40),
			tree: '2'.repeat(40),
			base: '3'.repeat(40),
		});
		const tampered = receipt(2);
		tampered.artifacts.halo.sha256 = '7'.repeat(64);
		tampered.receiptSha256 = receiptDigest((({ receiptSha256: _, ...body }) => body)(tampered));
		expect(() => validateReceiptDocuments([receipt(1), tampered], policy)).toThrow(
			'release artifacts differs across closeout attempts',
		);
	});

	test('rejects receipt mutation and keeps merge/readback/cleanup exact-SHA guarded', () => {
		const tampered = receipt(1);
		tampered.head = '8'.repeat(40);
		expect(() => validateReceiptDocuments([tampered, receipt(2)], policy)).toThrow('digest mismatch');
		const source = readFileSync(new URL('./closeout-evidence.ts', import.meta.url), 'utf8');
		expect(source).toContain('mainPromotionArgs(head, base, branch)');
		expect(source).toContain('beforePromotion.base.sha !== verified.base');
		expect(source).toContain('verify({ allowPromoted: true })');
		expect(source).toContain('const hostedBeforePromotion = await hostedEvidence(verified.head)');
		expect(source).not.toContain("['pr', 'merge'");
		expect(source).toContain("commit.tree?.sha !== verified.tree");
		expect(source).toContain("remoteHead !== verified.head");
		expect(source).toContain("['-C', repositoryDir, 'archive'");
		expect(source).toContain('nexus-closeout-evidence:');
		expect(source).toContain("mode === 'platform-record'");
		expect(source).not.toContain("valueAfter('--hosted-status')");
		expect(source).not.toContain("['repo', 'view'");
		expect(policy.hostedRequired).toBe(false);
		expect(policy.allowedHostedStatuses).toContain('INFRA_UNAVAILABLE');
		expect(policy.toolFiles).toContain('scripts/dependency-audit.ts');
		expect(policy.platform.image).toMatch(/^oven\/bun:[^@]+@sha256:[a-f0-9]{64}$/u);
		expect(policy.platform.environment).toEqual({
			PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
			PUPPETEER_SKIP_DOWNLOAD: 'true',
		});
		expect(policy.platform.lanes).toContainEqual(['test', 'scripts/platform-contract.test.ts']);
		expect(policy.platform.lanes).not.toContainEqual(['run', 'check:platform']);
		expect(() => assertDockerImageIdentity(policy.platform.image, 'sha256:wrong')).toThrow(
			'Docker image identity does not contain',
		);
		expect(() => assertDockerImageIdentity('oven/bun:1.4.0', 'sha256:unknown')).toThrow(
			'not pinned by digest',
		);
		assertDockerImageIdentity(
			policy.platform.image,
			`sha256:${'a'.repeat(64)} oven/bun@${policy.platform.image.split('@')[1]}`,
		);
	});

	test('uses exact JSON image metadata instead of Docker Go-template slice assumptions', () => {
		const digest = policy.platform.image.split('@')[1];
		const entry = { Id: `sha256:${'a'.repeat(64)}`, Os: 'linux', RepoDigests: [`oven/bun@${digest}`] };
		const output = JSON.stringify([entry]);
		const expected = `${entry.Id} ${entry.RepoDigests[0]}`;
		expect(parseDockerImageInspection(policy.platform.image, output)).toBe(expected);
		expect(parseDockerImageInspection(policy.platform.image, JSON.stringify([
			{ ...entry, RepoDigests: [`docker.io/oven/bun@${digest}`] },
		]))).toBe(`${entry.Id} docker.io/oven/bun@${digest}`);
		for (const invalid of ['not JSON', '[]', JSON.stringify([entry, entry]), JSON.stringify([
			{ ...entry, Os: 'windows' },
		]), JSON.stringify([{ ...entry, RepoDigests: [] }]), JSON.stringify([
			{ ...entry, RepoDigests: [`other/bun@${digest}`] },
		]), JSON.stringify([{ ...entry, Id: 'sha256:short' }])]) {
			expect(() => parseDockerImageInspection(policy.platform.image, invalid)).toThrow();
		}
		for (const invalid of [
			`${entry.Id} other/bun@${digest}`,
			`${entry.Id} prefix-oven/bun@${digest}`,
			`${entry.Id} oven/bun@${digest}suffix`,
			`${entry.Id} oven/bun@${digest} extra`,
		]) expect(() => assertDockerImageIdentity(policy.platform.image, invalid)).toThrow('exact');
	});

	test('inspects the real JSON command, bounds pull retries, and exposes inspection failures', () => {
		const output = JSON.stringify([{
			Id: `sha256:${'a'.repeat(64)}`, Os: 'linux',
			RepoDigests: [`oven/bun@${policy.platform.image.split('@')[1]}`],
		}]);
		const calls: string[][] = [];
		const expected = parseDockerImageInspection(policy.platform.image, output);
		expect(ensureDockerImage(policy.platform.image, (command, args) => {
			calls.push([command, ...args]);
			return calls.length === 1
				? { status: 1, stdout: '', stderr: 'No such image' }
				: { status: 0, stdout: args[0] === 'image' ? output : '', stderr: '' };
		})).toBe(expected);
		expect(calls).toEqual([
			['docker', 'image', 'inspect', policy.platform.image],
			['docker', 'pull', policy.platform.image],
			['docker', 'image', 'inspect', policy.platform.image],
		]);
		let pulls = 0;
		expect(() => ensureDockerImage(policy.platform.image, (_command, args) => {
			if (args[0] === 'pull') pulls += 1;
			return { status: args[0] === 'pull' ? 0 : 1, stdout: '', stderr: 'inspection denied' };
		})).toThrow('inspection denied');
		expect(pulls).toBe(3);
		let reads = 0;
		expect(() => ensureDockerImage(policy.platform.image, () => {
			reads += 1;
			return { status: 0, stdout: 'invalid JSON', stderr: '' };
		})).toThrow('invalid JSON');
		expect(reads).toBe(1);
	});

	test('atomically leases the exact main base and candidate head for one-commit promotion', () => {
		const head = 'a'.repeat(40);
		const base = 'b'.repeat(40);
		const branch = 'codex/exact-candidate';
		expect(mainPromotionArgs(head, base, branch)).toEqual([
			'push',
			'--atomic',
			`--force-with-lease=refs/heads/main:${base}`,
			`--force-with-lease=refs/heads/${branch}:${head}`,
			'origin',
			`${head}:refs/heads/main`,
			`:refs/heads/${branch}`,
		]);
		expect(() => mainPromotionArgs('HEAD', base, branch)).toThrow('exact Git SHAs');
		expect(() => mainPromotionArgs(head, base, 'main')).toThrow('distinct canonical candidate branch');
	});

	test('accepts only the exact base or an explicitly recoverable promoted head', () => {
		const identity = { head: 'a'.repeat(40), base: 'b'.repeat(40) };
		expect(classifyMainPosition(identity.base, identity, false)).toBe('base');
		expect(classifyMainPosition(identity.head, identity, true)).toBe('head');
		expect(() => classifyMainPosition(identity.head, identity, false)).toThrow('remote main moved');
		expect(() => classifyMainPosition('c'.repeat(40), identity, true)).toThrow('neither');
	});

	test('accepts both provider-merged and atomically promoted closed PR projections', () => {
		const head = 'a'.repeat(40);
		expect(isExactPromotionProjection({ state: 'closed' }, head)).toBe(true);
		expect(isExactPromotionProjection({
			state: 'closed',
			merged_at: '2026-08-13T00:00:00Z',
			merge_commit_sha: head,
		}, head)).toBe(true);
		expect(isExactPromotionProjection({ state: 'open' }, head)).toBe(false);
		expect(isExactPromotionProjection({
			state: 'closed',
			merged_at: '2026-08-13T00:00:00Z',
			merge_commit_sha: 'b'.repeat(40),
		}, head)).toBe(false);
		expect(isExactPromotionProjection({
			state: 'closed',
			merged_at: '2026-08-13T00:00:00Z',
		}, head)).toBe(false);
	});

	test('binds the current platform snapshot and forbids cross-repository promotion', () => {
		const recorded = receipt(1).platform;
		expect(() => assertPlatformEvidenceSnapshot(structuredClone(recorded), recorded)).not.toThrow();
		const replaced = structuredClone(recorded);
		replaced.evidenceSha256 = '8'.repeat(64);
		expect(() => assertPlatformEvidenceSnapshot(replaced, recorded)).toThrow(
			'current Linux platform evidence',
		);
		expect(() => assertSameRepositoryPull('QzCrane/nexus', 'QzCrane/nexus')).not.toThrow();
		expect(() => assertSameRepositoryPull('fork/nexus', 'QzCrane/nexus')).toThrow('same-repository');
	});

	test('creates exact-head evidence once and rejects a different replacement', () => {
		const directory = mkdtempSync(resolve(tmpdir(), 'nexus-closeout-immutable-'));
		const path = resolve(directory, 'receipt.json');
		try {
			expect(writeImmutableEvidenceFile(path, '{"head":"one"}\n')).toBe('created');
			expect(writeImmutableEvidenceFile(path, '{"head":"one"}\n')).toBe('existing');
			expect(() => writeImmutableEvidenceFile(path, '{"head":"two"}\n')).toThrow(
				'immutable closeout evidence already exists with different content',
			);
			expect(readFileSync(path, 'utf8')).toBe('{"head":"one"}\n');
		} finally {
			rmSync(directory, {
				recursive: true,
				force: true,
				maxRetries: 5,
				retryDelay: 100,
			});
		}
	});

	test('validates one immutable attempt before treating a retry as complete', () => {
		expect(() => validateReceiptDocument(receipt(1), policy, 1)).not.toThrow();
		const invalid = receipt(1);
		invalid.receiptSha256 = '0'.repeat(64);
		expect(() => validateReceiptDocument(invalid, policy, 1)).toThrow('digest mismatch');
	});

	test('derives GitHub repository identity locally and rejects ambiguous remotes', () => {
		expect(parseGitHubRepository('https://github.com/QzCrane/nexus.git')).toBe('QzCrane/nexus');
		expect(parseGitHubRepository('git@github.com:QzCrane/nexus.git')).toBe('QzCrane/nexus');
		expect(parseGitHubRepository('ssh://git@github.com/QzCrane/nexus')).toBe('QzCrane/nexus');
		expect(() => parseGitHubRepository('https://example.com/QzCrane/nexus.git')).toThrow(
			'not a canonical GitHub repository URL',
		);
		expect(() => parseGitHubRepository('https://github.com/QzCrane/nexus/extra.git')).toThrow(
			'not a canonical GitHub repository URL',
		);
	});

	test('parses one exact remote branch identity and rejects ambiguous output', () => {
		const sha = 'a'.repeat(40);
		expect(parseRemoteRef(`${sha}\trefs/heads/main`, 'refs/heads/main')).toBe(sha);
		expect(parseRemoteRef('', 'refs/heads/candidate')).toBeUndefined();
		expect(() => parseRemoteRef(`${sha}\trefs/heads/other`, 'refs/heads/main')).toThrow(
			'malformed',
		);
		expect(() => parseRemoteRef(
			`${sha}\trefs/heads/main\n${'b'.repeat(40)}\trefs/heads/main`,
			'refs/heads/main',
		)).toThrow('ambiguous');
	});

	test('retries transient GitHub transport failures but keeps authentication failures fail-closed', async () => {
		let calls = 0;
		const result = await githubReadJson<{ ok: boolean }>('/repos/QzCrane/nexus/actions/runs', {
			token: 'test-token',
			attempts: 3,
			sleep: async () => undefined,
			fetchImpl: async () => {
				calls += 1;
				if (calls < 3) throw new Error('transient TLS failure');
				return Response.json({ ok: true });
			},
		});
		expect(result).toEqual({ ok: true });
		expect(calls).toBe(3);

		await expect(githubReadJson('/repos/QzCrane/nexus/actions/runs', {
			token: 'test-token',
			attempts: 3,
			sleep: async () => undefined,
			fetchImpl: async () => new Response('denied', { status: 401 }),
		})).rejects.toThrow('failed without retry');
	});

	test('uses checked-in fail-closed Git hook launchers', () => {
		const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
			scripts: Record<string, string>;
		};
		expect(packageJson.scripts.prepare).toContain('install-repository-hooks.ts');
		for (const name of ['pre-commit', 'commit-msg', 'pre-push', 'post-merge']) {
			const source = readFileSync(new URL(`../../.githooks/${name}`, import.meta.url), 'utf8');
			expect(source).toContain('set -eu');
			expect(source).toContain('exit 1');
			expect(source).toContain(`lefthook run "${name}"`);
		}
	});
});
