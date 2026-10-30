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
	'popup-frame-geometry-chrome.spec.ts',
	'popup-inventory-latency.spec.ts',
	'runtime-long-session-performance.spec.ts',
	'runtime-stress-performance.spec.ts',
	'service-worker-wake-performance.spec.ts',
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
		.filter((path) => path.endsWith('.spec.ts')
			&& !chromeIntegrationTests.has(path)
			&& !path.startsWith('smoke/'))
		.sort((left, right) => left === right ? 0 : left < right ? -1 : 1);
}

const TEST_PROCESS_CONCURRENCY = Math.min(8, Math.max(1, availableParallelism()));

// A gate that can block forever is worse than a gate that fails: the 2026-10-28
// full run finished 117/118 files and then waited indefinitely on a child that
// kept its event loop alive. Every file now has a bounded budget, and a kill is
// reported as that specific file's failure instead of a silent stall.
const TEST_FILE_TIMEOUT_MS = Number(
	process.env.NEXUS_TEST_FILE_TIMEOUT_MS ?? 120_000,
);

interface TestProcessResult {
	test: string;
	status: number | null;
	stdout: string;
	stderr: string;
	error: Error | null;
}

function runIsolatedTest(test: string): Promise<TestProcessResult> {
	return new Promise((resolveTest) => {
		const child = spawn(process.execPath, ['test', '--timeout', '30000', `test/${test}`], {
			cwd: projectDir,
			stdio: ['ignore', 'pipe', 'pipe'],
			shell: false,
			windowsHide: true,
		});
		let stdout = '';
		let stderr = '';
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
let slowWarningTimer: ReturnType<typeof setTimeout> | undefined;
		const finish = (result: TestProcessResult): void => {
			if (settled) return;
			settled = true;
			if (timer !== undefined) clearTimeout(timer);
if (slowWarningTimer !== undefined) clearTimeout(slowWarningTimer);
			resolveTest(result);
		};
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => { stdout += chunk; });
		child.stderr.on('data', (chunk: string) => { stderr += chunk; });
		child.once('error', (error) => {
			finish({ test, status: null, stdout, stderr, error });
		});
		child.once('close', (status) => {
			finish({ test, status, stdout, stderr, error: null });
		});
		slowWarningTimer = setTimeout(() => {
if (!settled) {
console.warn(`[run-tests] SLOW TEST (>15s): ${test} is still executing...`);
}
}, 15_000);

timer = setTimeout(() => {
clearTimeout(slowWarningTimer);
const diagnostic = [
`[run-tests] TIMEOUT DIAGNOSTIC for ${test}:`,
`Budget: ${TEST_FILE_TIMEOUT_MS}ms`,
`Buffered stdout length: ${stdout.length}`,
`Buffered stderr length: ${stderr.length}`,
stdout.trim() ? `--- stdout tail ---\n${stdout.slice(-1000)}` : '(no stdout)',
stderr.trim() ? `--- stderr tail ---\n${stderr.slice(-1000)}` : '(no stderr)',
].join('\n');
child.kill('SIGKILL');
finish({
test,
status: null,
stdout,
stderr: `${stderr}\n${diagnostic}`,
error: new Error(`${test} exceeded ${TEST_FILE_TIMEOUT_MS}ms without exiting`),
});
}, TEST_FILE_TIMEOUT_MS);
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
