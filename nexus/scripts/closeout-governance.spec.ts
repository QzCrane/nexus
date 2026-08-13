import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
	assertPlatformEvidenceSnapshot,
	assertSameRepositoryPull,
	assertDockerImageIdentity,
	classifyMainPosition,
	githubReadJson,
	mainPromotionArgs,
	parseGitHubRepository,
	parseRemoteRef,
	receiptDigest,
	validateReceiptDocuments,
	validateReceiptDocument,
	writeImmutableEvidenceFile,
	type CloseoutPolicy,
	type CloseoutReceipt,
} from './closeout-evidence';

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
		host: { platform: 'win32', bun: '1.3.14', chromium: 'test' },
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
		expect(policy.platform.image).toMatch(/^oven\/bun:1\.3\.14@sha256:[a-f0-9]{64}$/u);
		expect(policy.platform.environment).toEqual({
			PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
			PUPPETEER_SKIP_DOWNLOAD: 'true',
		});
		expect(policy.platform.lanes).toContainEqual(['test', 'scripts/platform-contract.test.ts']);
		expect(policy.platform.lanes).not.toContainEqual(['run', 'check:platform']);
		expect(() => assertDockerImageIdentity(policy.platform.image, 'sha256:wrong')).toThrow(
			'Docker image identity does not contain',
		);
		expect(() => assertDockerImageIdentity('oven/bun:1.3.14', 'sha256:unknown')).toThrow(
			'not pinned by digest',
		);
		assertDockerImageIdentity(
			policy.platform.image,
			`sha256:local oven/bun@${policy.platform.image.split('@')[1]}`,
		);
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
