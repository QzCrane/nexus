import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = dirname(dirname(fileURLToPath(import.meta.url)));
const testDir = resolve(projectDir, 'test');
const chromeIntegrationTests = new Set([
	'accessibility-chrome.spec.ts',
	'diagnostics-chrome.spec.ts',
	'performance.spec.ts',
	'runtime-long-session-performance.spec.ts',
	'runtime-stress-performance.spec.ts',
	'service-worker-wake-performance.spec.ts',
	'smoke.spec.ts',
	'tab-visibility-chrome.spec.ts',
	'visual-baseline.spec.ts',
]);

function walk(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(directory, entry.name);
		return entry.isDirectory() ? walk(path) : [path];
	});
}

export function listDefaultTests() {
	return walk(testDir)
		.map((path) => relative(testDir, path).replaceAll('\\', '/'))
		.filter((path) => path.endsWith('.spec.ts') && !chromeIntegrationTests.has(path))
		.sort((left, right) => left === right ? 0 : left < right ? -1 : 1);
}

const TEST_PROCESS_CONCURRENCY = Math.min(8, Math.max(1, availableParallelism()));

interface TestProcessResult {
	test: string;
	status: number | null;
	stdout: string;
	stderr: string;
	error: Error | null;
}

function runIsolatedTest(test: string): Promise<TestProcessResult> {
	return new Promise((resolveTest) => {
		const child = spawn(process.execPath, ['test', `test/${test}`], {
			cwd: projectDir,
			stdio: ['ignore', 'pipe', 'pipe'],
			shell: false,
			windowsHide: true,
		});
		let stdout = '';
		let stderr = '';
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => { stdout += chunk; });
		child.stderr.on('data', (chunk: string) => { stderr += chunk; });
		child.once('error', (error) => {
			resolveTest({ test, status: null, stdout, stderr, error });
		});
		child.once('close', (status) => {
			resolveTest({ test, status, stdout, stderr, error: null });
		});
	});
}

export async function runDefaultTests(): Promise<void> {
	const tests = listDefaultTests();
	if (tests.length === 0) throw new Error('Default SPECTRA test matrix is empty');
	console.log(
		`Running ${tests.length} isolated unit, contract, and runtime test files `
		+ `(concurrency ${TEST_PROCESS_CONCURRENCY})`,
	);
	const results: TestProcessResult[] = new Array(tests.length);
	let nextIndex = 0;
	const workers = Array.from(
		{ length: Math.min(TEST_PROCESS_CONCURRENCY, tests.length) },
		async () => {
			while (nextIndex < tests.length) {
				const index = nextIndex;
				nextIndex += 1;
				const test = tests[index];
				if (!test) continue;
				const result = await runIsolatedTest(test);
				results[index] = result;
				console.log(`${result.status === 0 && !result.error ? 'PASS' : 'FAIL'} ${test}`);
			}
		},
	);
	await Promise.all(workers);

	const failures = results.filter((result) => result.error || result.status !== 0);
	for (const failure of failures) {
		console.error(`\n--- ${failure.test} ---`);
		if (failure.stdout.trim()) console.error(failure.stdout.trimEnd());
		if (failure.stderr.trim()) console.error(failure.stderr.trimEnd());
		if (failure.error) console.error(failure.error);
	}
	if (failures.length > 0) {
		throw new Error(`${failures.length} isolated SPECTRA test file(s) failed`);
	}
	console.log(`All ${results.length} isolated SPECTRA test files passed`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	if (args.length === 1 && args[0] === '--list') console.log(listDefaultTests().join('\n'));
	else if (args.length === 0) await runDefaultTests();
	else throw new Error(`Unknown run-tests option: ${args.join(', ')}`);
}
