import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { collectHostedEvidence, latestRunAttempts, readAllPages, readHostedExecution, requiredHostedPlan, validateHostedObservation, type HostedJob, type HostedWorkflowRun } from './closeout-hosted';

const repository = resolve(import.meta.dir, '../..');
const input = { repository: 'QzCrane/nexus', head: '1'.repeat(40), tree: '2'.repeat(40), base: '3'.repeat(40), plan: [{ path: '.github/workflows/quality.yml', jobs: ['quality (Windows)'] }] };
const run: HostedWorkflowRun = { id: 11, workflow_id: 22, path: input.plan[0].path, event: 'pull_request', head_sha: input.head, run_attempt: 1, status: 'completed', conclusion: 'success', html_url: 'https://github.com/QzCrane/nexus/actions/runs/11', check_suite_id: 33 };
const job: HostedJob = {
	id: 44, name: 'quality (Windows)', status: 'completed', conclusion: 'success', run_id: 11,
	run_url: 'https://api.github.com/repos/QzCrane/nexus/actions/runs/11', head_sha: input.head, workflow_name: 'Quality',
	runner_id: 55, check_run_url: 'https://api.github.com/repos/QzCrane/nexus/check-runs/66',
	steps: [
		{ name: 'Verify exact checkout at start', status: 'completed', conclusion: 'success' },
		{ name: 'Verify exact checkout at end', status: 'completed', conclusion: 'success' },
	],
};
const execution = { schemaVersion: 1, authority: 'github-actions-execution', repository: input.repository, runId: '11', runAttempt: '1', job: 'quality', os: 'Windows', advertisedHead: input.head, executedCommit: input.head, executedTree: input.tree, base: input.base };
const executionLog = (record = execution) => `${JSON.stringify({ ...record, phase: 'start' })}\n${JSON.stringify({ ...record, phase: 'end' })}`;

function harness(options: { runs?: HostedWorkflowRun[]; jobs?: HostedJob[]; workflowId?: number; app?: string; text?: string; annotations?: unknown } = {}) {
	return collectHostedEvidence(input, async (path) => {
		if (path.includes('/actions/runs?')) return { total_count: options.runs?.length ?? 1, workflow_runs: options.runs ?? [run] };
		if (path.includes('/actions/workflows/')) return { id: options.workflowId ?? run.workflow_id, name: 'Quality', path: run.path, state: 'active' };
		if (path.includes('/check-suites/')) return { head_sha: input.head, repository: { full_name: input.repository }, app: { id: 15368, slug: options.app ?? 'github-actions', owner: { login: 'github' } } };
		if (path.includes('/jobs?')) {
			const requestedRun = Number(/\/actions\/runs\/(\d+)\//u.exec(path)?.[1]);
			const defaultJob = { ...job, run_id: requestedRun, run_url: `https://api.github.com/repos/QzCrane/nexus/actions/runs/${requestedRun}` };
			return { total_count: options.jobs?.length ?? 1, jobs: options.jobs ?? [defaultJob] };
		}
		if (path.includes('/annotations')) return (options.annotations ?? [{ message: 'Payments have failed' }]) as Record<string, unknown>;
		throw new Error(`Unexpected API request: ${path}`);
	}, async () => options.text ?? executionLog());
}

describe('complete hosted execution authority', () => {
	test('projects current workflows and native changed-path scope instead of a second name list', () => {
		const full = requiredHostedPlan(repository, ['nexus/bun.lock', 'nexus/docs/README.md']);
		expect(full).toHaveLength(5);
		expect(full.flatMap((entry) => entry.jobs)).toHaveLength(9);
		const docs = requiredHostedPlan(repository, ['nexus/docs/README.md']);
		expect(docs.find((entry) => entry.path.endsWith('cross-platform.yml'))?.jobs).toEqual(['product scope (ubuntu)', 'quality (ubuntu-latest)', 'quality (windows-latest)']);
		expect(docs.some((entry) => entry.path.endsWith('minimum-chrome.yml'))).toBe(false);
	});

	test('records actual executed checkout and authenticated provider app metadata', async () => {
		const result = await harness();
		expect(result.status).toBe('SUCCESS');
		expect(result.runs[0].jobs[0].execution?.executedTree).toBe(input.tree);
		expect(() => validateHostedObservation(result, input)).not.toThrow();
	});

	test('binds every native job identity to its REST run and workflow owner', async () => {
		for (const changed of [
			{ run_id: 12 },
			{ run_url: 'https://api.github.com/repos/QzCrane/nexus/actions/runs/12' },
			{ head_sha: '9'.repeat(40) },
			{ workflow_name: 'Lookalike' },
		]) await expect(harness({ jobs: [{ ...job, ...changed }] })).rejects.toThrow('native run identity');
	});

	test('rejects missing workflows, all skips, unfinished jobs and same-name different workflow/app', async () => {
		await expect(harness({ runs: [] })).rejects.toThrow('Required hosted workflow is missing');
		await expect(harness({ workflowId: 99 })).rejects.toThrow('Required hosted workflow is missing');
		await expect(harness({ app: 'same-name-custom-check' })).rejects.toThrow('does not belong');
		await expect(harness({ jobs: [] })).rejects.toThrow('missing or duplicated');
		await expect(harness({ jobs: [job, { ...job, id: 45 }] })).rejects.toThrow('missing or duplicated');
		await expect(harness({ jobs: [{ ...job, conclusion: 'skipped' }] })).rejects.toThrow('did not pass');
		await expect(harness({ jobs: [{ ...job, status: 'in_progress' }] })).rejects.toThrow('pending');
		await expect(harness({ jobs: [{ ...job, steps: [] }] })).rejects.toThrow('checkout identity');
	});

	test('accepts only same-run newer attempts as supersession and preserves independent failures', async () => {
		const latest = { ...run, run_attempt: 2 };
		expect(latestRunAttempts([{ ...run, conclusion: 'failure' }, latest], input.head)).toEqual([latest]);
		await expect(harness({ runs: [run, { ...run, id: 12, event: 'workflow_dispatch', conclusion: 'failure' }] })).rejects.toThrow('did not pass');
		for (const conclusion of ['cancelled', 'timed_out', 'skipped']) {
			await expect(harness({ runs: [{ ...run, conclusion }] })).rejects.toThrow('did not pass');
		}
		expect(() => latestRunAttempts([run, { ...latest, path: 'different.yml' }], input.head)).toThrow('identity changed');
	});

	test('allocation failure requires exact required-job coverage and rejects unrelated or mixed billing failures', async () => {
		const failure = { ...run, conclusion: 'failure' };
		const unallocated = { ...job, conclusion: 'failure', runner_id: 0, steps: [] };
		const result = await harness({ runs: [failure], jobs: [unallocated] });
		expect(result.status).toBe('INFRA_UNAVAILABLE');
		expect(() => validateHostedObservation(result, input)).not.toThrow();
		await expect(harness({ runs: [failure], jobs: [unallocated], annotations: [] })).rejects.toThrow('billing evidence');
		await expect(harness({ runs: [failure], jobs: [unallocated, { ...job, id: 45, name: 'product', conclusion: 'failure' }] })).rejects.toThrow('not an allocation failure');
		await expect(harness({ runs: [failure], jobs: [{ ...unallocated, id: 45, name: 'unrelated' }] })).rejects.toThrow('missing or duplicated');
	});

	test('accepts skipped required jobs only through a declared billing-failed needs chain', async () => {
		const failure = { ...run, conclusion: 'failure' };
		const root = { ...job, name: 'root', conclusion: 'failure', runner_id: 0, steps: [] };
		const downstream = { ...job, id: 45, name: 'downstream', conclusion: 'skipped', runner_id: 0, steps: [] };
		const causalInput = { ...input, plan: [{ ...input.plan[0], jobs: ['root', 'downstream'], needs: { root: [], downstream: ['root'] } }] };
		const causalHarness = () => collectHostedEvidence(causalInput, async (path) => {
			if (path.includes('/actions/runs?')) return { total_count: 1, workflow_runs: [failure] };
			if (path.includes('/actions/workflows/')) return { id: run.workflow_id, name: 'Quality', path: run.path, state: 'active' };
			if (path.includes('/check-suites/')) return { head_sha: input.head, repository: { full_name: input.repository }, app: { id: 15368, slug: 'github-actions', owner: { login: 'github' } } };
			if (path.includes('/jobs?')) return { total_count: 2, jobs: [root, downstream] };
			if (path.includes('/annotations')) return [{ message: 'Payments have failed' }];
			throw new Error(`Unexpected API request: ${path}`);
		}, async () => executionLog());
		expect((await causalHarness()).status).toBe('INFRA_UNAVAILABLE');
		await expect(collectHostedEvidence({ ...causalInput, plan: [{ ...causalInput.plan[0], needs: { root: [], downstream: [] } }] }, async (path) => {
			if (path.includes('/actions/runs?')) return { total_count: 1, workflow_runs: [failure] };
			if (path.includes('/actions/workflows/')) return { id: run.workflow_id, name: 'Quality', path: run.path, state: 'active' };
			if (path.includes('/check-suites/')) return { head_sha: input.head, repository: { full_name: input.repository }, app: { id: 15368, slug: 'github-actions', owner: { login: 'github' } } };
			if (path.includes('/jobs?')) return { total_count: 2, jobs: [root, downstream] };
			if (path.includes('/annotations')) return [{ message: 'Payments have failed' }];
			throw new Error(`Unexpected API request: ${path}`);
		}, async () => executionLog())).rejects.toThrow('no proven allocation-failure cause');
	});

	test('retains the second page and rejects incomplete, drifting or provider-truncated inventories', async () => {
		const read = async (path: string) => ({ total_count: 101, items: path.endsWith('page=1') ? Array.from({ length: 100 }, (_, id) => id) : ['second-page-failure'] });
		expect((await readAllPages(read, '/inventory', 'items')).at(-1)).toBe('second-page-failure');
		await expect(readAllPages(async (path) => { if (path.endsWith('page=2')) throw new Error('second page failed'); return read(path); }, '/inventory', 'items')).rejects.toThrow('second page failed');
		await expect(readAllPages(async () => ({ total_count: 1_000, items: [] }), '/runs', 'items', 1_000)).rejects.toThrow('complete-read limit');
		await expect(readAllPages(async (path) => ({ total_count: path.endsWith('page=1') ? 101 : 102, items: [1] }), '/inventory', 'items')).rejects.toThrow('changed during pagination');
	});

	test('rejects recycled metadata, wrong tree/base/attempt and duplicate log identity', async () => {
		for (const field of ['executedCommit', 'executedTree', 'base', 'runAttempt']) {
			await expect(harness({ text: executionLog({ ...execution, [field]: '9'.repeat(40) }) })).rejects.toThrow('does not match');
		}
		await expect(harness({ text: JSON.stringify({ ...execution, phase: 'start' }) })).rejects.toThrow('exact start and end');
		await expect(harness({ text: `${JSON.stringify({ ...execution, phase: 'start' })}\n${JSON.stringify({ ...execution, executedTree: '9'.repeat(40), phase: 'end' })}` })).rejects.toThrow('changed during');
		const result = await harness();
		result.runs[0].jobs[0].execution = null;
		expect(() => validateHostedObservation(result, input)).toThrow('lacks executed identity');
	});

	test('the actual workflow entrypoint records Git checkout and rejects advertised mismatch', () => {
		const directory = mkdtempSync(resolve(tmpdir(), 'nexus-hosted-execution-'));
		const git = (...args: string[]) => spawnSync('git', args, { cwd: repository, encoding: 'utf8' }).stdout.trim();
		const head = git('rev-parse', 'HEAD');
		const tree = git('rev-parse', 'HEAD^{tree}');
		// Mirror the entrypoint's parent derivation: cat-file -p still exposes the
		// parent line in a shallow CI checkout where `git show --format=%P` grafts it away.
		const base = git('cat-file', '-p', 'HEAD').split('\n').filter((line) => line.startsWith('parent '))[0]?.slice('parent '.length) ?? '';
		try {
			const eventPath = resolve(directory, 'event.json');
			writeFileSync(eventPath, JSON.stringify({ pull_request: { head: { sha: head }, base: { sha: base } } }));
			const execute = (phase: 'start' | 'end') => spawnSync(process.execPath, [resolve(import.meta.dir, 'hosted-execution.mjs'), phase], { cwd: repository, encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_PATH: eventPath, GITHUB_REPOSITORY: input.repository, GITHUB_RUN_ID: '11', GITHUB_RUN_ATTEMPT: '1', GITHUB_JOB: 'quality', RUNNER_OS: 'Windows' } });
			const start = execute('start');
			const end = execute('end');
			expect(start.status).toBe(0);
			expect(end.status).toBe(0);
			expect(readHostedExecution(`${start.stdout}${end.stdout}`, { repository: input.repository, head, tree, base, run: 11, attempt: 1 }).executedCommit).toBe(head);
			writeFileSync(eventPath, JSON.stringify({ pull_request: { head: { sha: '0'.repeat(40) }, base: { sha: base } } }));
			expect(execute('start').status).not.toBe(0);
		} finally { rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
	});
});
