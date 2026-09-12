// Hosted status is a complete execution plan, not an all-green sample of names.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyChangedPaths } from './ci-product-scope.mjs';

export interface HostedVerifierSource { gitBlob: string; sha256: string }
export interface HostedCheckPlan { path: string; jobs: string[]; needs?: Record<string, string[]>; verifier?: HostedVerifierSource }
export interface HostedJob {
	id: number; name: string; status: string; conclusion: string | null;
	run_id: number; run_url: string; head_sha: string; workflow_name: string;
	runner_id?: number; check_run_url?: string;
	steps?: Array<{ name: string; status: string; conclusion: string | null }>;
}
export interface HostedWorkflowRun {
	id: number; workflow_id: number; path: string; event: string; head_sha: string;
	run_attempt: number; status: string; conclusion: string | null; html_url: string;
	check_suite_id: number;
}

interface Workflow {
	name: string;
	on: { pull_request?: null | { paths?: string[] } };
	jobs: Record<string, {
		name?: string; if?: string;
		strategy?: { matrix: Record<string, string[]> };
		needs?: string | string[];
		steps: Array<{ name?: string; uses?: string; run?: string; if?: string; with?: { ref?: string; 'persist-credentials'?: boolean } }>;
	}>;
}

// biome-ignore lint/suspicious/noTemplateCurlyInString: This is the literal GitHub Actions expression, not a JavaScript template.
const CHECKOUT_REF = '${{ github.event.pull_request.head.sha || github.sha }}';
export function requiredHostedPlan(repository: string, changedPaths: readonly string[]): HostedCheckPlan[] {
	const scope = classifyChangedPaths(changedPaths);
	const verifierPath = resolve(repository, 'nexus/scripts/hosted-execution.mjs');
	const verifierBytes = readFileSync(verifierPath);
	const verifier = {
		gitBlob: Bun.spawnSync(['git', '-C', repository, 'hash-object', '--', verifierPath]).stdout.toString().trim(),
		sha256: createHash('sha256').update(verifierBytes).digest('hex'),
	};
	if (!/^[a-f0-9]{40}$/u.test(verifier.gitBlob)) throw new Error('Hosted verifier source has no Git blob identity');
	return readdirSync(resolve(repository, '.github/workflows')).filter((name) => /\.ya?ml$/u.test(name)).sort().flatMap((name) => {
		const path = `.github/workflows/${name}`;
		const workflow = Bun.YAML.parse(readFileSync(resolve(repository, path), 'utf8')) as Workflow;
		if (!workflow.on || !Object.hasOwn(workflow.on, 'pull_request')) return [];
		const paths = workflow.on.pull_request?.paths;
		if (paths && !changedPaths.some((changed) => paths.some((pattern) => new Bun.Glob(pattern).match(changed)))) return [];
		const selected = Object.entries(workflow.jobs).filter(([id]) => {
			if (path.endsWith('/cross-platform.yml') && id === 'closeout-platform') return false;
			if (path.endsWith('/cross-platform.yml') && id === 'build-and-test' && !scope.halo && !scope.spectra) return false;
			return true;
		});
		const namesById = new Map<string, string[]>();
		for (const [id, job] of selected) {
			const checkouts = job.steps.filter((step) => step.uses?.startsWith('actions/checkout@'));
			const firstIdentity = job.steps[1];
			const lastIdentity = job.steps.at(-1);
			if (checkouts.length !== 1 || job.steps[0] !== checkouts[0]
				|| checkouts[0].with?.ref !== CHECKOUT_REF || checkouts[0].with?.['persist-credentials'] !== false
				|| firstIdentity?.name !== 'Verify exact checkout at start' || firstIdentity.run !== 'node nexus/scripts/hosted-execution.mjs start'
				|| lastIdentity?.name !== 'Verify exact checkout at end' || lastIdentity.run !== 'node nexus/scripts/hosted-execution.mjs end'
				|| lastIdentity.if !== 'always()') {
				throw new Error(`${path}:${id} does not prove its exact execution checkout`);
			}
			let names = [job.name ?? id];
			for (const [axis, values] of Object.entries(job.strategy?.matrix ?? {})) {
				if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
					throw new Error(`${path}:${id} has an unsupported required-job matrix`);
				}
				names = names.flatMap((entry) => values.map((value) => entry.replaceAll(`\${{ matrix.${axis} }}`, value)));
			}
			if (names.some((entry) => entry.includes('${{'))) throw new Error(`${path}:${id} has unresolved job identity`);
			namesById.set(id, names);
		}
		const jobs = [...namesById.values()].flat();
		if (!jobs.length || new Set(jobs).size !== jobs.length) throw new Error(`${path} has an empty or ambiguous check plan`);
		const needs: Record<string, string[]> = {};
		for (const [id, job] of selected) {
			const upstreamIds = typeof job.needs === 'string' ? [job.needs] : (job.needs ?? []);
			const upstreamNames = upstreamIds.flatMap((upstream) => namesById.get(upstream) ?? []);
			if (upstreamIds.some((upstream) => !namesById.has(upstream))) throw new Error(`${path}:${id} depends on an unplanned required job`);
			for (const name of namesById.get(id) ?? []) needs[name] = upstreamNames;
		}
		return [{ path, jobs, needs, verifier }];
	});
}

export function assertHostedJobCoverage(jobs: readonly HostedJob[], required: readonly string[]): void {
	for (const name of required) {
		const matching = jobs.filter((job) => job.name === name);
		if (matching.length !== 1) throw new Error(`Required hosted job is missing or duplicated: ${name}`);
		const job = matching[0];
		if (job.status !== 'completed') throw new Error(`Required hosted job is pending: ${name}`);
		if (job.conclusion !== 'success') throw new Error(`Required hosted job did not pass: ${name}:${job.conclusion}`);
		for (const phase of ['start', 'end']) {
			if (!job.steps?.some((step) => step.name === `Verify exact checkout at ${phase}` && step.status === 'completed' && step.conclusion === 'success')) {
			throw new Error(`Required hosted job has no successful checkout identity: ${name}`);
			}
		}
	}
}

function requiredJobsByName(jobs: readonly HostedJob[], required: readonly string[]): Map<string, HostedJob> {
	const result = new Map<string, HostedJob>();
	for (const name of required) {
		const matching = jobs.filter((job) => job.name === name);
		if (matching.length !== 1) throw new Error(`Required hosted job is missing or duplicated: ${name}`);
		if (matching[0].status !== 'completed') throw new Error(`Required hosted job is pending: ${name}`);
		result.set(name, matching[0]);
	}
	return result;
}

function assertInfraCausality(requiredJobs: ReadonlyMap<string, HostedJob>, needs: Readonly<Record<string, string[]>>, billingFailures: ReadonlySet<string>): void {
	const visiting = new Set<string>();
	const proven = new Set(billingFailures);
	const prove = (name: string): boolean => {
		if (proven.has(name)) return true;
		const job = requiredJobs.get(name);
		if (job?.conclusion !== 'skipped' || visiting.has(name)) return false;
		visiting.add(name);
		const upstream = needs[name] ?? [];
		const caused = upstream.length > 0 && upstream.some((dependency) => prove(dependency))
			&& upstream.every((dependency) => requiredJobs.get(dependency)?.conclusion === 'success' || prove(dependency));
		visiting.delete(name);
		if (caused) proven.add(name);
		return caused;
	};
	for (const [name, job] of requiredJobs) {
		if (job.conclusion === 'success' || billingFailures.has(name)) continue;
		if (!prove(name)) throw new Error(`Required hosted job has no proven allocation-failure cause: ${name}:${job.conclusion}`);
	}
}

export async function readAllPages<T>(
	read: (path: string) => Promise<unknown>,
	path: string, key: string, resultLimit = 10_000,
): Promise<T[]> {
	const values: T[] = [];
	let total: number | undefined;
	const ids = new Set<number>();
	for (let page = 1; page <= 100; page += 1) {
		const result = await read(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
		if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error(`Invalid GitHub page: ${key}`);
		const items = result[key];
		if (!Array.isArray(items) || !Number.isSafeInteger(result.total_count) || Number(result.total_count) < 0) throw new Error(`Incomplete GitHub page: ${key}`);
		if (Number(result.total_count) >= resultLimit) throw new Error(`GitHub ${key} reached the complete-read limit`);
		if (total !== undefined && total !== result.total_count) throw new Error(`GitHub ${key} changed during pagination`);
		total = Number(result.total_count);
		if (key === 'workflow_runs' || key === 'jobs') {
			for (const item of items) {
				if (!item || !Number.isSafeInteger(item.id) || item.id <= 0 || ids.has(item.id)) throw new Error(`GitHub ${key} has a missing or repeated physical identity`);
				ids.add(item.id);
			}
		}
		values.push(...items as T[]);
		if (values.length > total) throw new Error(`GitHub ${key} page exceeds its declared total`);
		if (values.length === total) return values;
		if (!items.length) throw new Error(`GitHub pagination stopped before complete ${key}`);
	}
	throw new Error(`GitHub ${key} inventory exceeds the bounded complete-read limit`);
}

async function readAllArrayPages(
	read: (path: string) => Promise<unknown>, path: string, resultLimit = 10_000,
): Promise<unknown[]> {
	const values: unknown[] = [];
	for (let page = 1; page <= 100; page += 1) {
		const result = await read(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
		if (!Array.isArray(result)) throw new Error('Invalid GitHub array page');
		values.push(...result);
		if (values.length >= resultLimit) throw new Error('GitHub array inventory reached the complete-read limit');
		if (result.length < 100) return values;
	}
	throw new Error('GitHub array inventory exceeds the bounded complete-read limit');
}

export function latestRunAttempts(runs: readonly HostedWorkflowRun[], head: string): HostedWorkflowRun[] {
	const latest = new Map<number, HostedWorkflowRun>();
	for (const run of runs) {
		if (run.head_sha !== head) throw new Error('Hosted inventory contains a different head');
		if (!Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) throw new Error('Hosted attempt identity is missing');
		const previous = latest.get(run.id);
		if (previous && (previous.workflow_id !== run.workflow_id || previous.event !== run.event || previous.path !== run.path)) {
			throw new Error('Hosted run identity changed across attempts');
		}
		if (!previous || previous.run_attempt < run.run_attempt) latest.set(run.id, run);
	}
	return [...latest.values()].sort((a, b) => a.id - b.id);
}

export interface HostedExecution {
	schemaVersion: 1;
	authority: 'github-actions-execution';
	repository: string;
	runId: string;
	runAttempt: string;
	job: string;
	os: string;
	advertisedHead: string;
	executedCommit: string;
	executedTree: string;
	base: string;
	verifierBlob?: string;
	verifierSha256?: string;
}

export interface HostedRunEvidence {
	runId: number;
	attempt: number;
	workflowId: number;
	path: string;
	event: string;
	url: string;
	result: 'PASS' | 'INFRA_UNAVAILABLE';
	app: { id: number; slug: string; owner: string };
	jobs: Array<{ id: number; name: string; conclusion: string; logsUrl: string; execution: HostedExecution | null }>;
}

export interface HostedEvidence {
	status: string;
	detail: string;
	authority: 'github-rest-observation';
	plan: HostedCheckPlan[];
	runs: HostedRunEvidence[];
}

function exactKeys(value: unknown, keys: string[], label: string): asserts value is Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new Error(`Invalid hosted ${label} fields`);
}

export function validateHostedObservation(value: HostedEvidence, identity: { head: string; tree: string; base: string }): void {
	exactKeys(value, ['status', 'detail', 'authority', 'plan', 'runs'], 'observation');
	if (value.authority !== 'github-rest-observation' || typeof value.detail !== 'string' || !value.detail
		|| !Array.isArray(value.plan) || !Array.isArray(value.runs)) throw new Error('Invalid hosted observation');
	if (value.status === 'NOT_APPLICABLE') {
		if (value.plan.length || value.runs.length) throw new Error('Applicable hosted work cannot be marked not applicable');
		return;
	}
	if (!value.plan.length || !value.runs.length) throw new Error('Hosted evidence is missing the required plan or runs');
	const paths = new Set<string>();
	for (const check of value.plan) {
		const planKeys = ['path', 'jobs', ...(check.needs === undefined ? [] : ['needs']), ...(check.verifier === undefined ? [] : ['verifier'])];
		exactKeys(check, planKeys, 'plan');
		if (typeof check.path !== 'string' || !/^\.github\/workflows\/[a-z0-9-]+\.ya?ml$/u.test(check.path)
			|| paths.has(check.path) || !Array.isArray(check.jobs) || !check.jobs.length
			|| check.jobs.some((job) => typeof job !== 'string' || !job) || new Set(check.jobs).size !== check.jobs.length) throw new Error('Invalid hosted required-job plan');
		if (check.needs !== undefined && (!check.needs || typeof check.needs !== 'object' || Array.isArray(check.needs)
			|| Object.keys(check.needs).some((name) => !check.jobs.includes(name) || !Array.isArray(check.needs?.[name])
				|| check.needs[name].some((dependency) => !check.jobs.includes(dependency))))) throw new Error('Invalid hosted required-job dependencies');
		if (check.verifier !== undefined) {
			exactKeys(check.verifier, ['gitBlob', 'sha256'], 'verifier source');
			if (!/^[a-f0-9]{40}$/u.test(check.verifier.gitBlob) || !/^[a-f0-9]{64}$/u.test(check.verifier.sha256)) throw new Error('Invalid hosted verifier source identity');
		}
		paths.add(check.path);
	}
	const ids = new Set<number>();
	for (const run of value.runs) {
		exactKeys(run, ['runId', 'attempt', 'workflowId', 'path', 'event', 'url', 'result', 'app', 'jobs'], 'run');
		if (![run.runId, run.attempt, run.workflowId].every((id) => Number.isSafeInteger(id) && id > 0)
			|| ids.has(run.runId) || typeof run.path !== 'string' || typeof run.event !== 'string'
			|| !['PASS', 'INFRA_UNAVAILABLE'].includes(run.result) || !Array.isArray(run.jobs)) throw new Error('Invalid hosted run identity');
		ids.add(run.runId);
		const url = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/actions\/runs\/(\d+)\/attempts\/(\d+)$/u.exec(run.url);
		if (!url || Number(url[2]) !== run.runId || Number(url[3]) !== run.attempt) throw new Error('Invalid hosted run URL');
		exactKeys(run.app, ['id', 'slug', 'owner'], 'app');
		if (!Number.isSafeInteger(run.app.id) || run.app.id <= 0 || run.app.slug !== 'github-actions' || run.app.owner !== 'github') throw new Error('Invalid hosted builder app');
		const jobIds = new Set<number>();
		for (const job of run.jobs) {
			exactKeys(job, ['id', 'name', 'conclusion', 'logsUrl', 'execution'], 'job');
			if (!Number.isSafeInteger(job.id) || job.id <= 0 || jobIds.has(job.id) || !job.name || !job.conclusion
				|| job.logsUrl !== `https://github.com/${url[1]}/actions/runs/${run.runId}/job/${job.id}`) throw new Error('Invalid hosted job identity');
			jobIds.add(job.id);
			if (job.execution !== null) {
				validateHostedExecutionRecord(job.execution, { ...identity, repository: url[1], run: run.runId, attempt: run.attempt });
			}
		}
	}
	for (const check of value.plan) {
		const matches = value.runs.filter((run) => run.path === check.path && run.event === 'pull_request');
		if (!matches.length) throw new Error('Required hosted workflow is missing from receipt');
		for (const run of matches) {
			const required = new Map(check.jobs.map((name) => [name, run.jobs.filter((job) => job.name === name)]));
			for (const name of check.jobs) {
				const jobs = required.get(name) ?? [];
				if (jobs.length !== 1) throw new Error('Required hosted job lacks exact identity');
				if (run.result === 'PASS' && (jobs[0].conclusion !== 'success' || !jobs[0].execution)) throw new Error('Required hosted job lacks executed identity');
				if (jobs[0].execution && check.verifier && (jobs[0].execution.verifierBlob !== check.verifier.gitBlob || jobs[0].execution.verifierSha256 !== check.verifier.sha256)) throw new Error('Hosted verifier source differs from the reviewed candidate');
			}
			if (run.result === 'INFRA_UNAVAILABLE') {
				const requiredJobs = new Map([...required].map(([name, jobs]) => [name, { ...jobs[0], run_id: run.runId, run_url: '', head_sha: identity.head, workflow_name: '' } as HostedJob]));
				const failures = new Set([...requiredJobs].filter(([, job]) => job.conclusion === 'failure').map(([name]) => name));
				assertInfraCausality(requiredJobs, check.needs ?? {}, failures);
			}
		}
	}
	const status = value.runs.some((run) => run.result === 'INFRA_UNAVAILABLE') ? 'INFRA_UNAVAILABLE' : 'SUCCESS';
	if (value.status !== status) throw new Error('Hosted aggregate status contradicts its runs');
}

export function readHostedExecution(log: string, expected: {
	repository: string; head: string; tree: string; base: string; run: number; attempt: number; verifier?: HostedVerifierSource;
}): HostedExecution {
	const records: Array<HostedExecution & { phase: 'start' | 'end' }> = [];
	for (const line of log.split('\n')) {
		if (!line.includes('"authority":"github-actions-execution"')) continue;
		const start = line.indexOf('{');
		if (start < 0) throw new Error('Hosted execution log contains malformed identity');
		try { records.push(JSON.parse(line.slice(start).trim()) as HostedExecution & { phase: 'start' | 'end' }); }
		catch { throw new Error('Hosted execution log contains malformed identity'); }
	}
	if (records.length !== 2 || records[0].phase !== 'start' || records[1].phase !== 'end') throw new Error('Hosted execution log must contain exact start and end checkout identities');
	const [{ phase: _start, ...record }, { phase: _end, ...final }] = records;
	if (JSON.stringify(record) !== JSON.stringify(final)) throw new Error('Hosted execution identity changed during the job');
	validateHostedExecutionRecord(record, expected);
	if (expected.verifier && (record.verifierBlob !== expected.verifier.gitBlob || record.verifierSha256 !== expected.verifier.sha256)) throw new Error('Hosted verifier source differs from the reviewed candidate');
	return record;
}

function validateHostedExecutionRecord(record: HostedExecution, expected: {
	repository: string; head: string; tree: string; base: string; run: number; attempt: number;
}): void {
	const keys = ['schemaVersion', 'authority', 'repository', 'runId', 'runAttempt', 'job', 'os', 'advertisedHead', 'executedCommit', 'executedTree', 'base',
		...(record.verifierBlob === undefined && record.verifierSha256 === undefined ? [] : ['verifierBlob', 'verifierSha256'])];
	exactKeys(record, keys, 'execution');
	if (record.schemaVersion !== 1 || record.authority !== 'github-actions-execution'
		|| record.repository !== expected.repository || record.advertisedHead !== expected.head
		|| record.executedCommit !== expected.head || record.executedTree !== expected.tree || record.base !== expected.base
		|| record.runId !== String(expected.run) || record.runAttempt !== String(expected.attempt)
		|| !record.job || !['Linux', 'Windows', 'macOS'].includes(record.os)
		|| ((record.verifierBlob !== undefined || record.verifierSha256 !== undefined)
			&& (!/^[a-f0-9]{40}$/u.test(record.verifierBlob ?? '') || !/^[a-f0-9]{64}$/u.test(record.verifierSha256 ?? '')))) {
		throw new Error('Hosted executed source, builder or attempt does not match the candidate');
	}
}

export async function collectHostedEvidence(
	input: { repository: string; head: string; tree: string; base: string; plan: HostedCheckPlan[] },
	read: (path: string) => Promise<unknown>,
	readText: (path: string) => Promise<string>,
): Promise<HostedEvidence> {
	const { repository, head, tree, base, plan } = input;
	if (!plan.length) return { status: 'NOT_APPLICABLE', detail: 'No hosted workflow applies to the canonical changed-path plan', authority: 'github-rest-observation', plan, runs: [] };
	const prefix = `/repos/${repository}`;
	const inventory = await readAllPages<HostedWorkflowRun>(read, `${prefix}/actions/runs?head_sha=${head}`, 'workflow_runs', 1_000);
	// Dependabot's provider-generated maintenance is not an execution of repository workflows.
	const runs = latestRunAttempts(inventory, head).filter((run) => run.event !== 'dynamic');
	const requiredIds = new Map<number, { check: HostedCheckPlan; workflowName: string }>();
	for (const check of plan) {
		const value = await read(`${prefix}/actions/workflows/${check.path.split('/').at(-1)}`);
		if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Hosted workflow owner is invalid: ${check.path}`);
		const owner = value as Record<string, unknown>;
		if (!Number.isSafeInteger(owner.id) || owner.path !== check.path || owner.state !== 'active') throw new Error(`Hosted workflow owner is inactive or mismatched: ${check.path}`);
		if (typeof owner.name !== 'string' || !owner.name) throw new Error(`Hosted workflow owner has no stable name: ${check.path}`);
		requiredIds.set(Number(owner.id), { check, workflowName: owner.name });
		if (!runs.some((run) => run.workflow_id === owner.id && run.path === check.path && run.event === 'pull_request')) throw new Error(`Required hosted workflow is missing: ${check.path}`);
	}
	const evidence: HostedRunEvidence[] = [];
	for (const run of runs) {
		if (run.status !== 'completed') throw new Error(`Hosted workflow remains pending: ${run.html_url}`);
		const suiteValue = await read(`${prefix}/check-suites/${run.check_suite_id}`);
		if (!suiteValue || typeof suiteValue !== 'object' || Array.isArray(suiteValue)) throw new Error('Hosted check suite is invalid');
		const suite = suiteValue as Record<string, unknown>;
		const app = suite.app as { id?: unknown; slug?: unknown; owner?: { login?: unknown } } | undefined;
		if (suite.head_sha !== head || (suite.repository as { full_name?: unknown })?.full_name !== repository
			|| app?.slug !== 'github-actions' || app.owner?.login !== 'github' || !Number.isSafeInteger(app.id)) {
			throw new Error('Hosted check suite does not belong to GitHub Actions and this candidate');
		}
		const jobs = await readAllPages<HostedJob>(read, `${prefix}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, 'jobs');
		const requiredOwner = run.event === 'pull_request' ? requiredIds.get(run.workflow_id) : undefined;
		for (const job of jobs) {
			if (job.run_id !== run.id || job.run_url !== `https://api.github.com${prefix}/actions/runs/${run.id}` || job.head_sha !== head
				|| typeof job.workflow_name !== 'string' || !job.workflow_name
				|| (requiredOwner && job.workflow_name !== requiredOwner.workflowName)) {
				throw new Error(`Hosted job native run identity does not match its workflow run: ${job.name}`);
			}
		}
		const required = requiredOwner?.check;
		if (required && required.path !== run.path) throw new Error('Hosted workflow id has a different path');
		const requiredJobs = required ? requiredJobsByName(jobs, required.jobs) : new Map<string, HostedJob>();
		let result: 'PASS' | 'INFRA_UNAVAILABLE' = 'PASS';
		if (run.conclusion !== 'success') {
			const failures = jobs.filter((job) => job.conclusion !== 'success' && job.conclusion !== 'skipped');
			if (run.conclusion !== 'failure' || !failures.length) throw new Error(`Hosted execution did not pass: ${run.html_url}:${run.conclusion}`);
			const billingFailures = new Set<string>();
			for (const job of failures) {
				if (job.conclusion !== 'failure' || job.runner_id !== 0 || (job.steps?.length ?? 0) !== 0 || !job.check_run_url) throw new Error(`Hosted product failure is not an allocation failure: ${job.name}`);
				const checkPath = new URL(job.check_run_url).pathname;
				if (!checkPath.startsWith(`${prefix}/check-runs/`)) throw new Error('Allocation check identity belongs to another repository');
				const annotations = await readAllArrayPages(read, `${checkPath}/annotations`);
				if (!/payments? have failed|spending limit|billing/iu.test(JSON.stringify(annotations))) throw new Error('Hosted allocation has no provider billing evidence');
				billingFailures.add(job.name);
			}
			if (required) {
				if ([...billingFailures].some((name) => !requiredJobs.has(name))) throw new Error('Unrelated billing failure cannot replace a required hosted job');
				assertInfraCausality(requiredJobs, required.needs ?? {}, billingFailures);
			}
			result = 'INFRA_UNAVAILABLE';
		}
		if (required && result === 'PASS') assertHostedJobCoverage(jobs, required.jobs);
		const executionJobs: HostedRunEvidence['jobs'] = [];
		for (const job of jobs) {
			let execution: HostedExecution | null = null;
			if (required?.jobs.includes(job.name) && job.conclusion === 'success') {
				execution = readHostedExecution(await readText(`${prefix}/actions/jobs/${job.id}/logs`), { repository, head, tree, base, run: run.id, attempt: run.run_attempt, verifier: required.verifier });
			}
			executionJobs.push({ id: job.id, name: job.name, conclusion: job.conclusion ?? 'unknown', logsUrl: `${run.html_url}/job/${job.id}`, execution });
		}
		evidence.push({ runId: run.id, attempt: run.run_attempt, workflowId: run.workflow_id, path: run.path, event: run.event, url: `${run.html_url}/attempts/${run.run_attempt}`, result, app: { id: Number(app.id), slug: String(app.slug), owner: String(app.owner.login) }, jobs: executionJobs });
	}
	return {
		status: evidence.some((run) => run.result === 'INFRA_UNAVAILABLE') ? 'INFRA_UNAVAILABLE' : 'SUCCESS',
		detail: evidence.map((run) => `${run.path}:${run.url}:${run.event}:${run.result}`).join(' | '),
		authority: 'github-rest-observation', plan, runs: evidence,
	};
}
