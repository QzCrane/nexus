import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { HostedEvidence } from './closeout-hosted';
import {
	createDurableCloseoutBundle,
	DURABLE_CLOSEOUT_NOTES_REF,
	parseDurableCloseoutBundle,
	projectFinalDelivery,
	publishDurableCloseoutEvidence,
	readRemoteDurableCloseoutEvidence,
	serializeDurableCloseoutBundle,
	type DeliverySnapshotV1,
	type DurableCandidateIdentity,
	type DurableCloseoutBundleV1,
	type GitRunner,
} from './durable-evidence';

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

function digest(value: unknown): string {
	return createHash('sha256').update(canonical(value)).digest('hex');
}

function git(cwd: string, args: string[], input?: string): string {
	const result = spawnSync('git', args, { cwd, encoding: 'utf8', input, shell: false });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
	return result.stdout.trim();
}

function candidate(repository: string): DurableCandidateIdentity {
	const head = git(repository, ['rev-parse', 'HEAD']);
	return {
		head,
		tree: git(repository, ['show', '-s', '--format=%T', head]),
		base: git(repository, ['show', '-s', '--format=%P', head]),
		pr: Number.parseInt(git(repository, ['show', '-s', '--format=%ct', head]), 10),
		headRef: `refs/heads/candidate-${head.slice(0, 8)}`,
		baseRef: 'refs/heads/main',
	};
}

function hosted(identity: DurableCandidateIdentity): HostedEvidence {
	return {
		status: 'SUCCESS',
		detail: 'cross-platform:PASS',
		authority: 'github-rest-observation',
		plan: [{ path: '.github/workflows/cross-platform.yml', jobs: ['Build'] }],
		runs: [{
			runId: 101,
			attempt: 2,
			workflowId: 202,
			path: '.github/workflows/cross-platform.yml',
			event: 'pull_request',
			url: 'https://github.com/QzCrane/nexus/actions/runs/101/attempts/2',
			result: 'PASS',
			app: { id: 15368, slug: 'github-actions', owner: 'github' },
			jobs: [{
				id: 303,
				name: 'Build',
				conclusion: 'success',
				logsUrl: 'https://github.com/QzCrane/nexus/actions/runs/101/job/303',
				execution: {
					schemaVersion: 1,
					authority: 'github-actions-execution',
					repository: 'QzCrane/nexus',
					runId: '101',
					runAttempt: '2',
					job: 'Build',
					os: 'Windows',
					advertisedHead: identity.head,
					executedCommit: identity.head,
					executedTree: identity.tree,
					base: identity.base,
				},
			}],
		}],
	};
}

function bundle(identity: DurableCandidateIdentity, asOf = '2026-09-11T00:00:00.000Z'): DurableCloseoutBundleV1 {
	const platformBody = {
		schemaVersion: 1,
		recordedAt: '2026-09-11T00:00:00.000Z',
		head: identity.head,
		tree: identity.tree,
		platform: 'linux',
	};
	const platform = { ...platformBody, evidenceSha256: digest(platformBody) };
	const receipts = [1, 2].map((attempt) => {
		const body = {
			schemaVersion: 1,
			attempt,
			recordedAt: `2026-09-11T00:00:0${attempt}.000Z`,
			head: identity.head,
			tree: identity.tree,
			base: identity.base,
			platform,
		};
		return { ...body, receiptSha256: digest(body) };
	});
	const deliverySnapshot: DeliverySnapshotV1 = {
		authority: 'git-remote-and-github-rest-observation',
		asOf,
		refs: {
			main: { ref: identity.baseRef, head: identity.base },
			candidate: { ref: identity.headRef, head: identity.head },
		},
		pullRequest: {
			number: identity.pr,
			state: 'open',
			draft: false,
			head: identity.head,
			base: identity.base,
			headRef: identity.headRef,
			baseRef: identity.baseRef,
		},
		receipts: receipts.map((receipt) => ({ attempt: receipt.attempt, sha256: receipt.receiptSha256 })),
		hosted: hosted(identity),
		result: 'VERIFIED_PENDING_PROMOTION',
		pending: ['atomic-main-promotion', 'provider-projection-readback', 'local-settlement'],
	};
	return createDurableCloseoutBundle({
		repository: 'QzCrane/nexus',
		candidate: identity,
		receipts,
		platform,
		deliverySnapshot,
	});
}

function initializeRepository(root: string): { repository: string; remote: string; first: DurableCandidateIdentity; second: DurableCandidateIdentity } {
	const repository = resolve(root, 'source');
	const remote = resolve(root, 'remote.git');
	git(root, ['init', '--bare', remote]);
	git(root, ['init', '--initial-branch=main', repository]);
	git(repository, ['config', 'user.name', 'NEXUS test']);
	git(repository, ['config', 'user.email', 'nexus-test@example.invalid']);
	writeFileSync(resolve(repository, 'source.txt'), 'base\n');
	git(repository, ['add', 'source.txt']);
	git(repository, ['commit', '-m', 'base']);
	writeFileSync(resolve(repository, 'source.txt'), 'first\n');
	git(repository, ['commit', '-am', 'first']);
	const first = candidate(repository);
	writeFileSync(resolve(repository, 'source.txt'), 'second\n');
	git(repository, ['commit', '-am', 'second']);
	const second = candidate(repository);
	git(repository, ['remote', 'add', 'origin', remote]);
	return { repository, remote, first, second };
}

describe('durable closeout evidence', () => {
	test('cross-binds full receipts, platform, exact refs and structured hosted attempts', () => {
		const root = mkdtempSync(resolve(tmpdir(), 'nexus-durable-shape-'));
		try {
			const { first } = initializeRepository(root);
			const value = bundle(first);
			expect(parseDurableCloseoutBundle(serializeDurableCloseoutBundle(value), first)).toEqual(value);
			expect(value.deliverySnapshot.hosted.runs[0]?.attempt).toBe(2);
			const tampered = structuredClone(value);
			tampered.receipts[0].head = 'f'.repeat(40);
			expect(() => serializeDurableCloseoutBundle(tampered)).toThrow('receipt attempt 1');
			const staleExecution = structuredClone(value);
			const execution = staleExecution.deliverySnapshot.hosted.runs[0]?.jobs[0]?.execution;
			if (!execution) throw new Error('fixture execution missing');
			execution.executedTree = 'e'.repeat(40);
			const { bundleSha256: _, ...body } = staleExecution;
			staleExecution.bundleSha256 = digest(body);
			expect(() => serializeDurableCloseoutBundle(staleExecution)).toThrow('Hosted executed source');
		} finally {
			rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
		}
	}, 30_000);

	test('creates, reads, appends and idempotently preserves immutable candidate notes', () => {
		const root = mkdtempSync(resolve(tmpdir(), 'nexus-durable-notes-'));
		try {
			const { repository, first, second } = initializeRepository(root);
			const firstBundle = bundle(first);
			const created = publishDurableCloseoutEvidence(firstBundle, { repositoryDir: repository });
			expect(created.status).toBe('created');
			expect(readRemoteDurableCloseoutEvidence(first.head, { repositoryDir: repository }).bundle).toEqual(firstBundle);
			expect(publishDurableCloseoutEvidence(firstBundle, { repositoryDir: repository }).status).toBe('existing');

			const secondBundle = bundle(second, '2026-09-11T00:01:00.000Z');
			expect(publishDurableCloseoutEvidence(secondBundle, { repositoryDir: repository }).status).toBe('created');
			expect(readRemoteDurableCloseoutEvidence(first.head, { repositoryDir: repository }).bundle).toEqual(firstBundle);
			expect(readRemoteDurableCloseoutEvidence(second.head, { repositoryDir: repository }).bundle).toEqual(secondBundle);

			const conflicting = bundle(first, '2026-09-11T01:00:00.000Z');
			expect(() => publishDurableCloseoutEvidence(conflicting, { repositoryDir: repository })).toThrow('different durable');
			expect(git(repository, ['for-each-ref', '--format=%(refname)', 'refs/notes/nexus-closeout-read', 'refs/notes/nexus-closeout-write'])).toBe('');
		} finally {
			rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
		}
	}, 30_000);

	test('rebuilds on a stale expected-old CAS without losing a concurrent candidate note', () => {
		const root = mkdtempSync(resolve(tmpdir(), 'nexus-durable-cas-'));
		try {
			const { repository, remote, first, second } = initializeRepository(root);
			const concurrentRepository = resolve(root, 'concurrent');
			git(root, ['clone', repository, concurrentRepository]);
			git(concurrentRepository, ['config', 'user.name', 'NEXUS concurrent test']);
			git(concurrentRepository, ['config', 'user.email', 'nexus-concurrent@example.invalid']);
			git(concurrentRepository, ['remote', 'set-url', 'origin', remote]);
			const firstBundle = bundle(first);
			const secondBundle = bundle(second, '2026-09-11T00:02:00.000Z');
			let injected = false;
			const runGit: GitRunner = (args, input) => {
				if (args[0] === 'push' && !injected) {
					injected = true;
					publishDurableCloseoutEvidence(secondBundle, { repositoryDir: concurrentRepository });
				}
				const result = spawnSync('git', [...args], { cwd: repository, encoding: 'utf8', input, shell: false });
				if (result.error) throw result.error;
				return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
			};
			expect(publishDurableCloseoutEvidence(firstBundle, { repositoryDir: repository, runGit }).status).toBe('created');
			expect(injected).toBe(true);
			expect(readRemoteDurableCloseoutEvidence(first.head, { repositoryDir: repository }).bundle).toEqual(firstBundle);
			expect(readRemoteDurableCloseoutEvidence(second.head, { repositoryDir: repository }).bundle).toEqual(secondBundle);
		} finally {
			rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
		}
	}, 30_000);

	test('projects final delivery from the immutable bundle and current readback', () => {
		const root = mkdtempSync(resolve(tmpdir(), 'nexus-durable-projection-'));
		try {
			const { first } = initializeRepository(root);
			const value = bundle(first);
			const complete = projectFinalDelivery(value, {
				asOf: '2026-09-11T02:00:00.000Z',
				main: { ref: first.baseRef, head: first.head, tree: first.tree },
				candidate: { ref: first.headRef, head: null },
				pullRequest: { number: first.pr, state: 'closed', head: first.head, baseRef: first.baseRef, mergedAt: null, mergeCommitSha: 'd'.repeat(40) },
				pending: [],
			});
			expect(complete.result).toBe('COMPLETE');
			expect(complete.pending).toEqual([]);
			expect(complete.hostedRuns[0]?.attempt).toBe(2);

			const pending = projectFinalDelivery(value, {
				asOf: '2026-09-11T01:30:00.000Z',
				main: { ref: first.baseRef, head: first.base, tree: 'a'.repeat(40) },
				candidate: { ref: first.headRef, head: first.head },
				pullRequest: { number: first.pr, state: 'open', head: first.head, baseRef: first.baseRef, mergedAt: null, mergeCommitSha: null },
				pending: ['local-primary-checkout-sync'],
			});
			expect(pending.result).toBe('PENDING');
			expect(pending.pending).toEqual([
				'atomic-main-promotion', 'local-primary-checkout-sync', 'candidate-ref-deletion', 'provider-projection-readback',
			]);
			const wrongTree = structuredClone(complete.pullRequest);
			expect(() => projectFinalDelivery(value, {
				asOf: complete.asOf,
				main: { ref: first.baseRef, head: first.head, tree: 'f'.repeat(40) },
				candidate: { ref: first.headRef, head: null },
				pullRequest: wrongTree,
				pending: [],
			})).toThrow('main tree');
		} finally {
			rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
		}
	}, 30_000);

	test('uses one canonical remote notes ref', () => {
		expect(DURABLE_CLOSEOUT_NOTES_REF).toBe('refs/notes/nexus-closeout');
	});
});
